import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  AGENT_CATALOG,
  AGENT_CATALOG_VERSION,
  AGENT_SLUGS,
  AGENT_RUN_STATUSES,
  RISK_ORDER,
  ACTION_RISK,
  agentMaxRisk,
  maxRisk,
  needsApproval,
  canDecideRun,
  type RiskClass,
} from "@/modules/agents/catalog";
import {
  RunAgentSchema,
  DecideAgentRunSchema,
  SetAgentEnabledSchema,
  AgentDefinitionsQuerySchema,
  AgentRunsQuerySchema,
  AgentRunDetailSchema,
} from "@/modules/agents/schemas";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

const SRC_DIR = path.join(process.cwd(), "src");
const DEFINE_ACTION_NAME = /defineAction\s*(?:<[^>]*>)?\s*\(\s*\{\s*name:\s*["'`]([A-Za-z0-9_.]+)["'`]/g;
const DEFINE_QUERY_NAME = /defineQuery\s*(?:<[^>]*>)?\s*\(\s*\{\s*name:\s*["'`]([A-Za-z0-9_.]+)["'`]/g;

// Rule 6 prohibited names (copied from rulings)
const PROHIBITED_PATTERN =
  /^(finance\.payment\.|finance\.invoice\.|finance\.structure\.|exam\.|admissions\.application\.|admissions\.enrol|attendance\.|core\.|agent\.|lifecycle\.|people\.|data\.import\.|document\.)/;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe("Agent catalog", () => {
  describe("Catalog exports", () => {
    it("exports version constant", () => {
      expect(AGENT_CATALOG_VERSION).toBe("agents_v1");
    });

    it("exports 6 agent slugs in correct order", () => {
      expect(AGENT_SLUGS).toEqual([
        "academic",
        "attendance",
        "admissions",
        "finance",
        "communication",
        "administrative",
      ]);
      expect(AGENT_SLUGS).toHaveLength(6);
    });

    it("exports 6 agent run statuses", () => {
      expect(AGENT_RUN_STATUSES).toEqual([
        "running",
        "done",
        "failed",
        "awaiting_approval",
        "rejected",
        "queued",
      ]);
      expect(AGENT_RUN_STATUSES).toHaveLength(6);
    });

    it("exports risk order", () => {
      expect(RISK_ORDER).toEqual([
        "read_only",
        "low_risk_reversible",
        "user_confirmed",
        "human_approved",
        "prohibited",
      ]);
    });

    it("exports ACTION_RISK map with all catalog actions", () => {
      const catalogActions = new Set<string>();
      for (const spec of Object.values(AGENT_CATALOG)) {
        for (const action of Object.keys(spec.actions)) {
          catalogActions.add(action);
        }
      }

      for (const action of catalogActions) {
        expect(ACTION_RISK, `ACTION_RISK missing ${action}`).toHaveProperty(action);
        const risk = ACTION_RISK[action];
        expect(risk, `${action} has invalid risk`).not.toBe("read_only");
        expect(risk, `${action} has invalid risk`).not.toBe("prohibited");
      }
    });

    it("exports full AGENT_CATALOG with 6 entries", () => {
      expect(Object.keys(AGENT_CATALOG)).toHaveLength(6);
      expect(Object.keys(AGENT_CATALOG)).toEqual(AGENT_SLUGS);
    });
  });

  describe("Catalog content", () => {
    it("each agent has name, roleDescription, tools, actions", () => {
      for (const [, spec] of Object.entries(AGENT_CATALOG)) {
        expect(spec).toHaveProperty("name");
        expect(spec).toHaveProperty("roleDescription");
        expect(spec).toHaveProperty("tools");
        expect(spec).toHaveProperty("actions");
        expect(typeof spec.name).toBe("string");
        expect(spec.name.length).toBeGreaterThan(0);
        expect(typeof spec.roleDescription).toBe("string");
        expect(spec.roleDescription.length).toBeGreaterThan(0);
        expect(spec.roleDescription.length).toBeLessThanOrEqual(400);
        expect(typeof spec.tools).toBe("object");
        expect(typeof spec.actions).toBe("object");
      }
    });

    it("tools and actions have descriptions ≤ 120 chars", () => {
      for (const spec of Object.values(AGENT_CATALOG)) {
        for (const desc of Object.values(spec.tools)) {
          expect(typeof desc).toBe("string");
          expect(desc.length).toBeGreaterThan(0);
          expect(desc.length).toBeLessThanOrEqual(120);
        }
        for (const desc of Object.values(spec.actions)) {
          expect(typeof desc).toBe("string");
          expect(desc.length).toBeGreaterThan(0);
          expect(desc.length).toBeLessThanOrEqual(120);
        }
      }
    });

    it("finance has no tool or action starting with exam", () => {
      const finance = AGENT_CATALOG.finance;
      for (const toolName of Object.keys(finance.tools)) {
        expect(toolName, `finance tool ${toolName} starts with exam`).not.toMatch(/^exam/i);
      }
      for (const actionName of Object.keys(finance.actions)) {
        expect(actionName, `finance action ${actionName} starts with exam`).not.toMatch(/^exam/i);
      }
    });

    it("admissions has no low_risk_reversible actions", () => {
      const admissions = AGENT_CATALOG.admissions;
      for (const action of Object.keys(admissions.actions)) {
        expect(ACTION_RISK[action]).not.toBe("low_risk_reversible");
      }
    });
  });

  describe("Registry validation", () => {
    it("every catalog tool is a defined query", () => {
      const queries = new Set<string>();
      for (const file of walk(SRC_DIR)) {
        if (file.endsWith(path.join("lib", "actions", "define-query.ts"))) continue;
        const content = fs.readFileSync(file, "utf8");
        for (const match of content.matchAll(DEFINE_QUERY_NAME)) queries.add(match[1]);
      }

      for (const spec of Object.values(AGENT_CATALOG)) {
        for (const tool of Object.keys(spec.tools)) {
          expect(queries, `catalog tool ${tool} is not defined`).toContain(tool);
        }
      }
    });

    it("every catalog action is a defined action", () => {
      const actions = new Set<string>();
      for (const file of walk(SRC_DIR)) {
        if (file.endsWith(path.join("lib", "actions", "define-action.ts"))) continue;
        const content = fs.readFileSync(file, "utf8");
        for (const match of content.matchAll(DEFINE_ACTION_NAME)) actions.add(match[1]);
      }

      for (const spec of Object.values(AGENT_CATALOG)) {
        for (const action of Object.keys(spec.actions)) {
          expect(actions, `catalog action ${action} is not defined`).toContain(action);
        }
      }
    });

    it("no catalog action matches prohibited pattern", () => {
      for (const spec of Object.values(AGENT_CATALOG)) {
        for (const action of Object.keys(spec.actions)) {
          expect(action, `action ${action} matches prohibited pattern`).not.toMatch(PROHIBITED_PATTERN);
        }
      }
    });
  });

  describe("Helper functions", () => {
    it("maxRisk with empty list returns read_only", () => {
      expect(maxRisk([])).toBe("read_only");
    });

    it("maxRisk returns highest risk", () => {
      expect(maxRisk(["read_only"])).toBe("read_only");
      expect(maxRisk(["read_only", "low_risk_reversible"])).toBe("low_risk_reversible");
      expect(maxRisk(["low_risk_reversible", "user_confirmed", "read_only"])).toBe("user_confirmed");
      expect(maxRisk(["human_approved", "low_risk_reversible"])).toBe("human_approved");
    });

    it("agentMaxRisk returns catalog max risk", () => {
      const finance = agentMaxRisk("finance");
      expect(finance).toBe("human_approved");

      const academic = agentMaxRisk("academic");
      expect(academic).toBe("user_confirmed");

      const attendance = agentMaxRisk("attendance");
      expect(attendance).toBe("human_approved");
    });

    it("needsApproval returns true for non-read_only risks", () => {
      expect(needsApproval("read_only")).toBe(false);
      expect(needsApproval("low_risk_reversible")).toBe(false);
      expect(needsApproval("user_confirmed")).toBe(true);
      expect(needsApproval("human_approved")).toBe(true);
    });

    it("canDecideRun logic", () => {
      const humanApprovedRun = { risk_class: "human_approved" as RiskClass, requested_by: "user-1" };
      const userConfirmedRun = { risk_class: "user_confirmed" as RiskClass, requested_by: "user-2" };

      // human_approved: only approver can decide
      expect(canDecideRun({ userId: "user-1", canApprove: false }, humanApprovedRun)).toBe(false);
      expect(canDecideRun({ userId: "user-1", canApprove: true }, humanApprovedRun)).toBe(true);
      expect(canDecideRun({ userId: "other", canApprove: false }, humanApprovedRun)).toBe(false);
      expect(canDecideRun({ userId: "other", canApprove: true }, humanApprovedRun)).toBe(true);

      // user_confirmed: requester or approver can decide
      expect(canDecideRun({ userId: "user-2", canApprove: false }, userConfirmedRun)).toBe(true);
      expect(canDecideRun({ userId: "user-2", canApprove: true }, userConfirmedRun)).toBe(true);
      expect(canDecideRun({ userId: "other", canApprove: false }, userConfirmedRun)).toBe(false);
      expect(canDecideRun({ userId: "other", canApprove: true }, userConfirmedRun)).toBe(true);
    });
  });

  describe("Zod schemas", () => {
    it("RunAgentSchema accepts valid input", () => {
      const result = RunAgentSchema.safeParse({ slug: "finance", task: "Send reminders" });
      expect(result.success).toBe(true);
    });

    it("RunAgentSchema rejects invalid slug", () => {
      const result = RunAgentSchema.safeParse({ slug: "invalid", task: "test" });
      expect(result.success).toBe(false);
    });

    it("RunAgentSchema trims and validates task length", () => {
      const result = RunAgentSchema.safeParse({ slug: "finance", task: "   " });
      expect(result.success).toBe(false);

      const long = "x".repeat(501);
      const resultLong = RunAgentSchema.safeParse({ slug: "finance", task: long });
      expect(resultLong.success).toBe(false);
    });

    it("RunAgentSchema enforces strict mode", () => {
      const result = RunAgentSchema.safeParse({ slug: "finance", task: "test", extra: "field" });
      expect(result.success).toBe(false);
    });

    it("DecideAgentRunSchema accepts valid input", () => {
      const result = DecideAgentRunSchema.safeParse({
        runId: "550e8400-e29b-41d4-a716-446655440000",
        note: "Looks good",
      });
      expect(result.success).toBe(true);
    });

    it("DecideAgentRunSchema rejects invalid UUID", () => {
      const result = DecideAgentRunSchema.safeParse({ runId: "not-uuid" });
      expect(result.success).toBe(false);
    });

    it("DecideAgentRunSchema note is optional", () => {
      const result = DecideAgentRunSchema.safeParse({
        runId: "550e8400-e29b-41d4-a716-446655440000",
      });
      expect(result.success).toBe(true);
      expect(result.data?.note).toBeUndefined();
    });

    it("SetAgentEnabledSchema accepts valid input", () => {
      const result = SetAgentEnabledSchema.safeParse({ slug: "finance", enabled: true });
      expect(result.success).toBe(true);
    });

    it("AgentDefinitionsQuerySchema accepts empty object", () => {
      const result = AgentDefinitionsQuerySchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("AgentRunsQuerySchema with defaults", () => {
      const result = AgentRunsQuerySchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("AgentRunsQuerySchema limit defaults to 50", () => {
      const result = AgentRunsQuerySchema.safeParse({});
      if (result.success) {
        expect(result.data.limit).toBe(50);
      }
    });

    it("AgentRunsQuerySchema rejects limit > 100", () => {
      const result = AgentRunsQuerySchema.safeParse({ limit: 101 });
      expect(result.success).toBe(false);
    });

    it("AgentRunDetailSchema accepts valid UUID", () => {
      const result = AgentRunDetailSchema.safeParse({
        runId: "550e8400-e29b-41d4-a716-446655440000",
      });
      expect(result.success).toBe(true);
    });
  });
});
