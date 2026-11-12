// Curveball sweep (fabric studio): submit/propose/decide at the action layer — roles, other school, Zod edges,
// decide before proposal, decide twice / in parallel. No AI call is ever reached here (every propose is refused first).
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { decideStudioRequest, proposeStudioRequest, submitStudioRequest } from "@/modules/fabric/studio.actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 3 });
let a: TestInstitution;
let b: TestInstitution;

const REQ = {
  title: "Bus tracking",
  problem: "Parents call the office to ask where the bus is.",
  desiredOutcome: "Parents see the bus location.",
  budgetRange: "under_50k",
  timeline: "Next term",
  successCriteria: "Fewer calls",
};

async function submitted(inst: TestInstitution = a): Promise<string> {
  const r = await callAs(inst, "admin", submitStudioRequest, REQ);
  if (!r.ok) throw new Error(r.error.code);
  return r.data.id;
}
async function proposed(inst: TestInstitution = a): Promise<string> {
  const id = await submitted(inst);
  await sql`update public.studio_requests set status = 'proposed', proposal = '{"resolution":"configuration"}'::jsonb where id = ${id}`;
  return id;
}

beforeAll(async () => {
  a = await createTestInstitution("studio-cb");
  b = await createTestInstitution("studio-cb-x");
});

afterAll(async () => {
  await a?.cleanup();
  await b?.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

describe("studio curveballs", () => {
  it("submit: admin succeeds as 'submitted' with created_by = caller; teacher/guardian forbidden", async () => {
    const r = await callAs(a, "admin", submitStudioRequest, REQ);
    expect(r.ok ? r.data.status : null).toBe("submitted");
    if (!r.ok) return;
    const [row] = await sql`select created_by, institution_id from public.studio_requests where id = ${r.data.id}`;
    expect([row.created_by, row.institution_id]).toEqual([a.users.admin.id, a.institutionId]);
    for (const role of ["teacher", "guardian"] as const) {
      const x = await callAs(a, role, submitStudioRequest, REQ);
      expect(x.ok ? null : x.error.code).toBe("forbidden");
    }
  });

  it.each([
    ["unknown budget range", { budgetRange: "a lot" }, "budgetRange"],
    ["11 user roles", { userRoles: Array.from({ length: 11 }, (_, i) => `role${i}`) }, "userRoles"],
    ["blank title", { title: "   " }, "title"],
    ["unknown key", { status: "approved" }, ""],
  ])("submit: %s → validation_failed", async (_l, patch, field) => {
    const r = await callAs(a, "admin", submitStudioRequest, { ...REQ, ...patch });
    expect(r.ok ? null : r.error.code).toBe("validation_failed");
    if (field) expect(r.ok ? null : r.error.fieldErrors?.[field]).toBeTruthy();
  });

  it("propose: another school's request / unknown id → not_found; an already-proposed request → invalid_state", async () => {
    const theirs = await submitted(b);
    const cross = await callAs(a, "admin", proposeStudioRequest, { requestId: theirs });
    expect(cross.ok ? null : cross.error.code).toBe("not_found");
    const unknown = await callAs(a, "admin", proposeStudioRequest, { requestId: crypto.randomUUID() });
    expect(unknown.ok ? null : unknown.error.code).toBe("not_found");
    const again = await callAs(a, "admin", proposeStudioRequest, { requestId: await proposed() });
    expect(again.ok ? null : again.error.code).toBe("invalid_state");
  });

  it("decide: before a proposal → invalid_state; admin → forbidden; another school's → not_found", async () => {
    const fresh = await submitted();
    const early = await callAs(a, "owner", decideStudioRequest, { requestId: fresh, decision: "approve" });
    expect(early.ok ? null : early.error.code).toBe("invalid_state");
    const p = await proposed();
    const adm = await callAs(a, "admin", decideStudioRequest, { requestId: p, decision: "approve" });
    expect(adm.ok ? null : adm.error.code).toBe("forbidden");
    const cross = await callAs(a, "owner", decideStudioRequest, { requestId: await proposed(b), decision: "reject" });
    expect(cross.ok ? null : cross.error.code).toBe("not_found");
  });

  it("decide twice → invalid_state; parallel approve+reject → exactly one decision", async () => {
    const id = await proposed();
    expect((await callAs(a, "owner", decideStudioRequest, { requestId: id, decision: "approve" })).ok).toBe(true);
    const twice = await callAs(a, "principal", decideStudioRequest, { requestId: id, decision: "reject", note: "Changed mind" });
    expect(twice.ok ? null : twice.error.code).toBe("invalid_state");
    const [row] = await sql`select status from public.studio_requests where id = ${id}`;
    expect(row.status).toBe("approved");

    const race = await proposed();
    const rs = await Promise.all([
      callAs(a, "owner", decideStudioRequest, { requestId: race, decision: "approve" }),
      callAs(a, "principal", decideStudioRequest, { requestId: race, decision: "reject" }),
    ]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
  });

  it("decide: unknown decision value or 501-char note → validation_failed", async () => {
    const d = await callAs(a, "owner", decideStudioRequest, { requestId: crypto.randomUUID(), decision: "maybe" });
    expect(d.ok ? null : d.error.fieldErrors?.decision).toBeTruthy();
    const n = await callAs(a, "owner", decideStudioRequest, { requestId: crypto.randomUUID(), decision: "approve", note: "x".repeat(501) });
    expect(n.ok ? null : n.error.fieldErrors?.note).toBeTruthy();
  });
});
