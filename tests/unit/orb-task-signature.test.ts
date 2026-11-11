import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ActionMeta } from "@/lib/actions/registry";
import { FIRST_SLICE, TASK_CATALOG } from "@/modules/ai/tasks/catalog";
import { actionJsonSchema, classify } from "@/modules/ai/tasks/derive";
import { signatureTokens, taskSignature } from "@/modules/ai/tasks/signature";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

let meta: ReadonlyMap<string, ActionMeta>;

beforeAll(async () => {
  await import("@/app/api/v1/actions/all-actions");
  meta = (await import("@/lib/actions/registry")).getActionMeta();
}, 30_000);

function signatureOf(name: string) {
  const m = meta.get(name);
  const row = TASK_CATALOG[name];
  if (!m || !row || row.excluded !== undefined) throw new Error(`${name} is not a classified, registered action`);
  const task = classify(name, m, row);
  return { task, sig: taskSignature(name, task, actionJsonSchema(m)) };
}

describe("task signatures (design §3)", () => {
  it("is one compact line: name, label, then fields with kind and required mark", () => {
    expect(signatureOf("library.loan.issue").sig).toBe("library.loan.issue: Issue a library book | accessionNo:key! studentId:ref staffId:ref");
  });

  it("never names a human-only, generated or context field", () => {
    for (const name of FIRST_SLICE) {
      const { task, sig } = signatureOf(name);
      const hidden = [...task.humanOnly, ...task.generated, ...Object.entries(task.entities).filter(([, e]) => e === "context").map(([p]) => p)];
      for (const p of hidden) expect(sig, `${name} leaks ${p}`).not.toMatch(new RegExp(`[ |]${p.split("/")[1]}:`));
    }
    expect(signatureOf("expenses.record").sig).not.toMatch(/amount:/);
  });

  it("keeps the five longest first-slice signatures under 250 estimated tokens", () => {
    const longest = FIRST_SLICE.map((n) => signatureOf(n).sig).sort((a, b) => b.length - a.length).slice(0, 5);
    expect(signatureTokens(longest.join("\n"))).toBeLessThan(250);
  });
});
