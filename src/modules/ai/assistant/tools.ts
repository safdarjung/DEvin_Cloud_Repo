import "server-only";
// Assistant read tools built from the curated catalog (catalog.ts) over the
// registered queries. Read-only: every tool runs the registered query as the
// caller (session client, RLS, the query's own module/Zod/permission gates).
// The tool filter is a convenience, not the boundary.
//
//  - "leader" mode: only `aggregate` catalog entries (no person rows).
//  - "guardian" mode: a fixed allowlist of per-student queries; the verified
//    `studentId` is forced into every call and hidden from the model's schema,
//    so the model cannot ask about any other child.
import { jsonSchema, tool, type JSONSchema7, type ToolSet } from "ai";
import { z } from "zod";
import { getQueryMeta, getRegisteredQueries } from "@/lib/actions/define-query";
import type { ActionResult } from "@/lib/actions/result";
import { hasPermission } from "@/lib/auth/require";
import type { TenantContext } from "@/lib/auth/types";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { ASSISTANT_QUERIES, type SourceLog } from "@/modules/ai/assistant/catalog";

export const MAX_ASSISTANT_TOOL_RESULT_CHARS = 4_000;

export type AssistantMode = "leader" | "guardian";

/** Per-student queries a guardian's assistant may use (all take `studentId`, except calendar.forRole). */
export const GUARDIAN_QUERY_ALLOWLIST: readonly string[] = [
  "people.getStudentProfile",
  "exams.listResultsForStudent",
  "mastery.gapsForStudent",
  "finance.listInvoicesForStudent",
  "calendar.forRole",
];

export function toolNameFor(name: string): string {
  return name.replace(/\./g, "_");
}

/** Catalog names a mode may be offered, before registry/permission/module filtering. */
export function candidateQueries(mode: AssistantMode): string[] {
  if (mode === "leader") {
    return Object.entries(ASSISTANT_QUERIES)
      .filter(([, spec]) => spec.aggregate === true)
      .map(([name]) => name);
  }
  return GUARDIAN_QUERY_ALLOWLIST.filter((name) => name in ASSISTANT_QUERIES);
}

function describeInput(schema: z.ZodType, hideStudentId: boolean) {
  const json = z.toJSONSchema(schema, { target: "draft-7", io: "input", unrepresentable: "any" }) as JSONSchema7;
  if (hideStudentId && json.properties && "studentId" in json.properties) {
    const rest = { ...json.properties };
    delete rest.studentId;
    json.properties = rest;
    if (json.required) json.required = json.required.filter((k) => k !== "studentId");
  }
  return jsonSchema<unknown>(json);
}

function takesStudentId(schema: z.ZodType): boolean {
  const json = z.toJSONSchema(schema, { target: "draft-7", io: "input", unrepresentable: "any" }) as JSONSchema7;
  return Boolean(json.properties && "studentId" in json.properties);
}

export async function buildAssistantTools(opts: {
  ctx: TenantContext;
  mode: AssistantMode;
  /** Verified child id (guardian mode). */
  studentId?: string;
  sources: SourceLog;
  nonce: string;
}): Promise<{ tools: ToolSet; registryNameOf: ReadonlyMap<string, string> }> {
  const { ctx, mode, studentId, sources, nonce } = opts;
  // Dynamic: the manifest imports modules that may import this one.
  await import("@/app/api/v1/query/all-queries");

  const tools: ToolSet = {};
  const registryNameOf = new Map<string, string>();

  for (const name of candidateQueries(mode)) {
    const query = getRegisteredQueries().get(name);
    const meta = getQueryMeta().get(name);
    // Function-valued permissions are excluded (fail closed).
    if (!query || !meta || typeof meta.permission !== "string") continue;
    if (!hasPermission(ctx, meta.permission)) continue;
    if (!meta.module || !isModuleEnabled(ctx, meta.module)) continue;

    const forceStudent = mode === "guardian" && takesStudentId(meta.schema);
    if (forceStudent && !studentId) continue;

    const toolName = toolNameFor(name);
    registryNameOf.set(toolName, name);
    tools[toolName] = tool({
      description: `${ASSISTANT_QUERIES[name].description} (query: ${name})`,
      inputSchema: describeInput(meta.schema, forceStudent),
      execute: async (modelInput: unknown): Promise<string> => {
        try {
          const base = typeof modelInput === "object" && modelInput !== null ? (modelInput as Record<string, unknown>) : {};
          // The model-supplied studentId (if any) is always overwritten.
          const input = forceStudent ? { ...base, studentId } : base;
          const result = (await query(ctx.institution.slug, input)) as ActionResult<unknown>;
          if (!result.ok) return `Query ${name} failed: ${result.error.code}`;
          sources.add(name, base);
          const payload = (JSON.stringify(result.data) ?? "null").slice(0, MAX_ASSISTANT_TOOL_RESULT_CHARS);
          return `<data-${nonce} query="${name}">${payload}</data-${nonce}>`;
        } catch (err) {
          console.error(`[assistant] tool "${name}" threw`, err);
          return `Query ${name} failed: internal`;
        }
      },
    });
  }

  return { tools, registryNameOf };
}
