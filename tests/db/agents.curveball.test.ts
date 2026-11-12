// Curveball sweep (agents): custom agent lifecycle misuse at the action layer — archive twice, edit archived,
// base swap, built-in agents untouchable, parallel duplicate create.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { archiveCustomAgent, createCustomAgent, updateCustomAgent } from "@/modules/agents/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 3 });
let a: TestInstitution;

const spec = (name: string) => ({
  name,
  summary: "Reports this term's fee collection totals.",
  instructions: "Only report collection totals.",
  examples: ["How much have we collected?"],
  baseSlug: "finance",
  tools: ["finance.termCollectionSummary"],
  actions: [],
});
async function created(name = `Watcher ${crypto.randomUUID().slice(0, 6)}`): Promise<string> {
  const r = await callAs(a, "principal", createCustomAgent, spec(name));
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.data.id;
}

beforeAll(async () => {
  a = await createTestInstitution("agents-cb");
});

afterAll(async () => {
  await a?.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

describe("custom agent curveballs", () => {
  it("archive twice → second is not_found; editing an archived agent → not_found", async () => {
    const id = await created();
    expect((await callAs(a, "owner", archiveCustomAgent, { id })).ok).toBe(true);
    const again = await callAs(a, "owner", archiveCustomAgent, { id });
    expect(again.ok ? null : again.error.code).toBe("not_found");
    const edit = await callAs(a, "principal", updateCustomAgent, { id, ...spec("Revived") });
    expect(edit.ok ? null : edit.error.code).toBe("not_found");
    const [row] = await sql`select archived_at from public.agent_definitions where id = ${id}`;
    expect(row.archived_at).not.toBeNull();
  });

  it("changing the base agent on update → not_found (base is fixed after create)", async () => {
    const id = await created();
    const r = await callAs(a, "principal", updateCustomAgent, { id, ...spec("Swapped"), baseSlug: "attendance", tools: [] });
    expect(r.ok).toBe(false);
    const [row] = await sql`select base_slug from public.agent_definitions where id = ${id}`;
    expect(row.base_slug).toBe("finance");
  });

  it("a built-in agent cannot be archived through the custom-agent action", async () => {
    const [builtIn] = await sql`select id from public.agent_definitions where base_slug is null and (institution_id is null or institution_id = ${a.institutionId}) limit 1`;
    if (!builtIn) return; // no built-in rows in this database
    const r = await callAs(a, "owner", archiveCustomAgent, { id: builtIn.id as string });
    expect(r.ok ? null : r.error.code).toBe("not_found");
  });

  it("two parallel creates with one name: exactly one row, the loser is conflict", async () => {
    const name = `Race ${crypto.randomUUID().slice(0, 6)}`;
    const rs = await Promise.all([callAs(a, "principal", createCustomAgent, spec(name)), callAs(a, "owner", createCustomAgent, spec(name))]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    const loser = rs.find((r) => !r.ok);
    expect(loser && !loser.ok ? loser.error.code : null).toBe("conflict");
  });

  it("archive / update with a non-uuid id → validation_failed on id; admin forbidden", async () => {
    const bad = await callAs(a, "owner", archiveCustomAgent, { id: "agent-1" });
    expect(bad.ok ? null : bad.error.fieldErrors?.id).toBeTruthy();
    const adm = await callAs(a, "admin", archiveCustomAgent, { id: crypto.randomUUID() });
    expect(adm.ok ? null : adm.error.code).toBe("forbidden");
  });
});
