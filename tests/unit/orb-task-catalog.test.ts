import { beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ActionMeta } from "@/lib/actions/registry";
import { FIRST_SLICE, TASK_CATALOG, UNCLASSIFIED, catalogRow } from "@/modules/ai/tasks/catalog";
import { RULE6_KINDS, actionJsonSchema, classify, deriveFieldKind, rule6Family, schemaFields } from "@/modules/ai/tasks/derive";
import type { TaskRow } from "@/modules/ai/tasks/types";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

type Meta = ReadonlyMap<string, ActionMeta>;
type Catalog = Readonly<Record<string, TaskRow>>;

/** Every failure condition of design §2 "Completeness test", one message per problem. */
function problems(meta: Meta, catalog: Catalog, frozen: readonly string[]): string[] {
  const rowOf = (name: string): TaskRow | undefined => (Object.hasOwn(catalog, name) ? catalog[name] : catalogRow(name));
  const isClassified = (name: string) => {
    const row = rowOf(name);
    return row !== undefined && row.excluded === undefined;
  };
  const out: string[] = [];

  for (const name of meta.keys()) {
    if (!rowOf(name) && !frozen.includes(name)) out.push(`${name}: unclassified and not in the frozen list`);
    if (rule6Family(name) && !rowOf(name)) out.push(`${name}: rule-6 match is neither excluded nor given a family`);
  }
  for (const name of Object.keys(catalog)) if (!meta.has(name)) out.push(`${name}: row for an action that is not registered`);
  for (const name of frozen) {
    if (!meta.has(name)) out.push(`${name}: frozen name is not registered`);
    if (rowOf(name)) out.push(`${name}: frozen name has a row`);
  }

  for (const [name, row] of Object.entries(catalog)) {
    const m = meta.get(name);
    if (!m || row.excluded !== undefined) continue;
    const task = classify(name, m, row);
    const fields = schemaFields(actionJsonSchema(m));
    const paths = new Set(fields.map((f) => f.path));
    for (const p of [...(row.humanOnly ?? []), ...(row.generated ?? []), ...Object.keys(row.entities ?? {})]) {
      if (!paths.has(p)) out.push(`${name}: ${p} is not in the input schema`);
    }
    if (rule6Family(name) && !task.family) out.push(`${name}: rule-6 match without a family`);
    for (const f of fields) {
      const kind = deriveFieldKind(m.module, f);
      if (RULE6_KINDS.has(kind) && !(task.family && task.humanOnly.includes(f.path))) {
        out.push(`${name}: ${kind} field ${f.path} must be human-only on a rule-6 row`);
      }
      if (kind === "entity" && !task.generated.includes(f.path) && !task.entities[f.path]) {
        out.push(`${name}: uuid field ${f.path} has no entity kind and is not generated or context`);
      }
    }
    if (task.undo && !(meta.has(task.undo) && isClassified(task.undo))) out.push(`${name}: undo ${task.undo} is not a registered, classified action`);
    if (m.permission === null && !task.visibleWith) out.push(`${name}: permission depends on input but the row has no visibleWith`);
  }
  return out;
}

let meta: Meta;

beforeAll(async () => {
  await import("@/app/api/v1/actions/all-actions");
  meta = (await import("@/lib/actions/registry")).getActionMeta();
}, 30_000);

describe("orb task catalog — completeness (design §2)", () => {
  it("the registry, catalog and frozen list agree", () => {
    expect(problems(meta, TASK_CATALOG, UNCLASSIFIED)).toEqual([]);
  });

  it("the frozen list is sorted and unique", () => {
    expect([...UNCLASSIFIED]).toEqual([...new Set(UNCLASSIFIED)].sort());
    expect(Object.isFrozen(UNCLASSIFIED)).toBe(true);
  });

  it("every first-slice action is classified, not excluded", () => {
    expect(FIRST_SLICE).toHaveLength(52);
    expect(FIRST_SLICE.filter((n) => TASK_CATALOG[n]?.label === undefined)).toEqual([]);
  });

  it("the design's exclusions are excluded", () => {
    for (const name of ["core.ai_role.set", "core.member.setRole", "agent.approve", "workflow.run.decide", "visitors.purge", "data.import.commit", "textbook.file.requestUpload", "document.getReadUrl", "notification.read", "study.quiz.submit", "form.respond", "safety.alert.send", "finance.payment.createIntent", "ai.study.note.save"]) {
      expect(catalogRow(name)?.excluded, name).toBeTruthy();
    }
  });
});

describe("orb task catalog — each failure condition fires", () => {
  const schema = z.object({ studentId: z.string().uuid(), amount: z.number().multipleOf(0.01), note: z.string().max(200) }).strict();
  const fake = (over: Partial<ActionMeta> = {}): Meta => new Map([["demo.thing.record", { schema, permission: "finance.read", module: "fees", ...over } as ActionMeta]]);
  const ok: TaskRow = { label: "Record a thing", family: "money", humanOnly: ["/amount"] };
  const run = (m: Meta, row: TaskRow | undefined, frozen: readonly string[] = []) => problems(m, row ? { "demo.thing.record": row } : {}, frozen).join("\n");

  it("a valid row has no problems", () => {
    expect(run(fake(), ok)).toBe("");
  });

  it("a new action outside the frozen list fails", () => {
    expect(run(fake(), undefined)).toMatch(/unclassified/);
    expect(run(fake(), undefined, ["demo.thing.record"])).toBe("");
  });

  it("a row for a missing action fails", () => {
    expect(problems(new Map(), { "gone.action": ok }, [])).toEqual(["gone.action: row for an action that is not registered"]);
  });

  it("a human-only path missing from the schema fails", () => {
    expect(run(fake(), { ...ok, humanOnly: ["/amount", "/receivedAt"] })).toMatch(/\/receivedAt is not in the input schema/);
  });

  it("a money field without a family and human-only path fails", () => {
    expect(run(fake(), { label: "Record a thing" })).toMatch(/rupees field \/amount must be human-only/);
  });

  it("a rule-6 name match with no family and no exclusion fails", () => {
    const m: Meta = new Map([["demo.payment.log", { schema: z.object({ note: z.string() }), permission: "finance.read", module: "fees" } as ActionMeta]]);
    expect(problems(m, {}, ["demo.payment.log"]).join("\n")).toMatch(/rule-6 match is neither excluded/);
    expect(problems(m, { "demo.payment.log": { label: "Log" } }, []).join("\n")).toMatch(/rule-6 match without a family/);
    expect(problems(m, { "demo.payment.log": { excluded: "rule 6: slice 2" } }, [])).toEqual([]);
  });

  it("a uuid field with no entity kind fails unless generated or context", () => {
    const m: Meta = new Map([["demo.widget.set", { schema: z.object({ widgetId: z.string().uuid() }), permission: "finance.read", module: "fees" } as ActionMeta]]);
    expect(problems(m, { "demo.widget.set": { label: "Set" } }, []).join("\n")).toMatch(/\/widgetId has no entity kind/);
    expect(problems(m, { "demo.widget.set": { label: "Set", entities: { "/widgetId": "context" } } }, [])).toEqual([]);
    expect(problems(m, { "demo.widget.set": { label: "Set", generated: ["/widgetId"] } }, [])).toEqual([]);
  });

  it("an undo target that is not registered fails", () => {
    expect(run(fake(), { ...ok, undo: "demo.thing.unrecord" })).toMatch(/undo demo\.thing\.unrecord/);
  });

  it("an input-dependent permission without visibleWith fails", () => {
    expect(run(fake({ permission: null }), ok)).toMatch(/no visibleWith/);
    expect(run(fake({ permission: null }), { ...ok, visibleWith: "finance.read" })).toBe("");
  });

  it("a frozen name that is classified or no longer registered fails", () => {
    expect(run(fake(), ok, ["demo.thing.record"])).toMatch(/frozen name has a row/);
    expect(run(fake(), ok, ["demo.gone"])).toMatch(/demo\.gone: frozen name is not registered/);
  });
});
