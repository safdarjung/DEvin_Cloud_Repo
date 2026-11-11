import { describe, expect, it, vi } from "vitest";
import { permissionsFor } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import { allModulesOn } from "@/lib/modules/catalog";
import { AGENT_CATALOG, MAX_CUSTOM_INSTRUCTIONS, agentMaxRisk, scopedSpec } from "@/modules/agents/catalog";
import { CreateCustomAgentSchema, RunAgentSchema, UpdateCustomAgentSchema } from "@/modules/agents/schemas";
import { buildAgentTools, createProposalSink } from "@/modules/agents/tools";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

const VALID = {
  name: "Overdue books helper",
  summary: "Chases overdue library books for class 8.",
  instructions: "Only look at class 8 loans. Suggest renewals for loans less than a week overdue.",
  examples: ["Which class 8 books are overdue?"],
  baseSlug: "library",
  tools: ["library.overdue"],
  actions: ["library.loan.renew"],
};

function issuePaths(input: unknown): string[] {
  const parsed = CreateCustomAgentSchema.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((i) => i.path.join("."));
}

describe("custom agent schema", () => {
  it("accepts a subset of the base agent's tools and actions", () => {
    expect(CreateCustomAgentSchema.safeParse(VALID).success).toBe(true);
  });

  it("rejects a tool that is not in the base agent", () => {
    expect(issuePaths({ ...VALID, tools: ["library.overdue", "finance.listDefaulters"] })).toContain("tools");
  });

  it("rejects an action that is not in the base agent", () => {
    expect(issuePaths({ ...VALID, actions: ["finance.reminders.send"] })).toContain("actions");
  });

  it("rejects instructions over the hard cap", () => {
    expect(issuePaths({ ...VALID, instructions: "x".repeat(MAX_CUSTOM_INSTRUCTIONS + 1) })).toContain("instructions");
  });

  it("rejects more than three example prompts", () => {
    expect(issuePaths({ ...VALID, examples: ["a?", "b?", "c?", "d?"] })).toContain("examples");
  });

  it("rejects a custom agent with no tools at all", () => {
    expect(issuePaths({ ...VALID, tools: [] })).toContain("tools");
  });

  it("rejects an unknown base agent", () => {
    expect(issuePaths({ ...VALID, baseSlug: "custom_00000000000000000000000000000000" })).toContain("baseSlug");
  });

  it("update validates the subset against the given base too", () => {
    const parsed = UpdateCustomAgentSchema.safeParse({ ...VALID, id: crypto.randomUUID(), tools: ["exams.listExams"] });
    expect(parsed.success).toBe(false);
  });

  it("agent.run accepts a catalog slug or a server-made custom slug, nothing else", () => {
    expect(RunAgentSchema.safeParse({ slug: "finance", task: "x" }).success).toBe(true);
    expect(RunAgentSchema.safeParse({ slug: `custom_${"a".repeat(32)}`, task: "x" }).success).toBe(true);
    expect(RunAgentSchema.safeParse({ slug: "custom_finance", task: "x" }).success).toBe(false);
  });
});

describe("scopedSpec", () => {
  it("drops tools and actions outside the base agent, even when stored that way", () => {
    const spec = scopedSpec("library", {
      tools: ["library.overdue", "finance.listDefaulters"],
      actions: ["finance.reminders.send", "library.loan.renew"],
    });
    expect(Object.keys(spec.tools)).toEqual(["library.overdue"]);
    expect(Object.keys(spec.actions)).toEqual(["library.loan.renew"]);
    expect(spec.roleDescription).toBe(AGENT_CATALOG.library.roleDescription);
  });

  it("without a scope returns the base agent unchanged", () => {
    expect(scopedSpec("finance")).toBe(AGENT_CATALOG.finance);
  });

  it("risk comes from the catalog for the kept actions only", () => {
    expect(agentMaxRisk("finance")).toBe("human_approved");
    expect(agentMaxRisk("finance", { tools: ["finance.listDefaulters"], actions: [] })).toBe("read_only");
  });
});

describe("buildAgentTools with a custom scope", () => {
  const ctx: TenantContext = {
    institution: { id: "inst-1", slug: "custom-test", name: "Custom", settings: { modules: allModulesOn() }, ai_policy: "local_only", is_demo: true },
    user: { id: "user-1", profile: { fullName: "Owner", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role: "owner", staffId: null, guardianId: null, studentId: null },
    permissions: new Set(permissionsFor("owner")),
  };

  it("offers only the subset's tools, never the rest of the base agent", async () => {
    const { tools } = await buildAgentTools(ctx, "finance", createProposalSink(), "n0nce", {
      tools: ["finance.listDefaulters", "exams.listExams"],
      actions: [],
    });
    expect(Object.keys(tools)).toEqual(["finance_listDefaulters"]);
  });
});
