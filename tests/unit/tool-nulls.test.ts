// Groq rejects `null` for optional tool params server-side. Every chat tool's
// provider-facing schema must allow null on optional props, and nulls must
// reach the handler as absent keys.
import { describe, expect, it, vi } from "vitest";
import { asSchema, tool, type ToolSet } from "ai";
import { z } from "zod";
import { permissionsFor } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import { allModulesOn } from "@/lib/modules/catalog";
import { tolerateNullOptionals } from "@/lib/ai/tool-nulls";
import { buildReadTools } from "@/modules/agents/tools";
import { buildDraftTools } from "@/modules/ai/kernel/draft-tools";
import { ASSISTANT_QUERIES } from "@/modules/ai/assistant/catalog";
import { DRAFTABLE_ACTIONS } from "@/modules/ai/capabilities/catalog";
import { teacherTools } from "@/modules/ai/agent/teacher-tools";
import { studentTools } from "@/modules/ai/agent/student-tools";

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

const ctx: TenantContext = {
  institution: { id: "i", slug: "nulls", name: "N", settings: { modules: allModulesOn() }, ai_policy: "cloud_allowed", is_demo: true },
  user: { id: "u", profile: { fullName: "P", phone: null, avatarPath: null, isPlatformAdmin: false } },
  membership: { role: "principal", staffId: "s", guardianId: null, studentId: null },
  permissions: new Set(permissionsFor("principal")),
} as unknown as TenantContext;

type Node = { properties?: Record<string, Node>; required?: string[]; items?: Node; anyOf?: Node[]; type?: string };

function optionalProps(node: Node, path = ""): Array<[string, Node]> {
  const out: Array<[string, Node]> = [];
  for (const [k, v] of Object.entries(node.properties ?? {})) {
    if (!node.required?.includes(k)) out.push([`${path}${k}`, v]);
    out.push(...optionalProps(v.anyOf?.[0] ?? v, `${path}${k}.`));
  }
  if (node.items) out.push(...optionalProps(node.items, `${path}[]`));
  return out;
}

async function allTools(): Promise<ToolSet> {
  const catalog = Object.fromEntries(Object.entries(ASSISTANT_QUERIES).map(([k, v]) => [k, v.description]));
  const { tools: read } = await buildReadTools(ctx, catalog, "n");
  const drafts = await buildDraftTools(ctx, [{ description: "d", drafts: DRAFTABLE_ACTIONS }]);
  return { ...read, ...drafts, ...(await teacherTools(ctx)), ...((await studentTools(ctx, { visualsEnabled: true })) as ToolSet) };
}

describe("tolerateNullOptionals", () => {
  it("allows null on every optional property of every chat tool", async () => {
    const tools = tolerateNullOptionals(await allTools());
    expect(Object.keys(tools).length).toBeGreaterThan(20);
    let optionalCount = 0;
    for (const [name, t] of Object.entries(tools)) {
      const root = asSchema(t.inputSchema as never).jsonSchema as Node;
      for (const [path, prop] of optionalProps(root)) {
        optionalCount++;
        expect(prop.anyOf?.some((s) => s.type === "null"), `${name}.${path}`).toBe(true);
      }
    }
    expect(optionalCount).toBeGreaterThan(0);
  });

  it("passes nulls for optional fields to the handler as absent keys", async () => {
    const handler = vi.fn(async (input: unknown) => input);
    const tools = tolerateNullOptionals({
      t: tool({ description: "x", inputSchema: z.object({ a: z.string().optional(), b: z.string().optional(), id: z.string() }), execute: handler }),
    });
    const schema = asSchema(tools.t.inputSchema as never);
    const res = await schema.validate!({ a: null, b: "x", id: "1" });
    expect(res).toEqual({ success: true, value: { b: "x", id: "1" } });
    expect(Object.keys((res as { value: object }).value)).not.toContain("a");
  });

  it("still rejects null for a required field", async () => {
    const tools = tolerateNullOptionals({ t: tool({ description: "x", inputSchema: z.object({ id: z.string() }), execute: async () => "" }) });
    const res = await asSchema(tools.t.inputSchema as never).validate!({ id: null });
    expect(res.success).toBe(false);
  });
});
