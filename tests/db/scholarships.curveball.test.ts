// Curveball sweep (scholarships): validation edges, concurrent decide/request, unknown ids.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { decideConcessionAward, requestConcessionAward, saveConcessionRule, setConcessionRuleActive } from "@/modules/scholarships/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
let a: TestInstitution;
let ruleId: string;

async function freshStudent(): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${a.institutionId}, ${`SC-${crypto.randomUUID().slice(0, 8)}`}, 'Award', '2015-01-01', 'other') returning id
  `;
  return row.id as string;
}

beforeAll(async () => {
  a = await createTestInstitution("schol-cb");
  await sql`
    insert into public.academic_years (institution_id, name, starts_on, ends_on, is_current)
    values (${a.institutionId}, '2026-27', '2026-04-01', '2027-03-31', true)
  `;
  const r = await callAs(a, "accountant", saveConcessionRule, { name: "Sibling", percent: 12.5 });
  if (!r.ok) throw new Error("rule setup failed");
  ruleId = r.data.id;
}, 120_000);

afterAll(async () => {
  await a?.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

describe("scholarships curveballs", () => {
  it.each([
    ["percent above 100", { name: "X1", percent: 100.01 }, "percent"],
    ["percent zero", { name: "X2", percent: 0 }, "percent"],
    ["percent with 3 decimals", { name: "X3", percent: 10.005 }, "percent"],
    ["fractional paise", { name: "X4", amountPaise: 100.5 }, "amountPaise"],
    ["negative paise", { name: "X5", amountPaise: -100 }, "amountPaise"],
    ["neither percent nor amount", { name: "X6" }, "percent"],
    ["both percent and amount", { name: "X7", percent: 5, amountPaise: 100 }, "percent"],
  ])("rule: %s → validation_failed on %s", async (_l, body, field) => {
    const r = await callAs(a, "accountant", saveConcessionRule, body);
    expect(r.ok ? null : r.error.code).toBe("validation_failed");
    expect(r.ok ? null : r.error.fieldErrors?.[field as string]).toBeTruthy();
  });

  it("decide on an unknown award id → not_found; set-active on an unknown rule → not_found", async () => {
    const d = await callAs(a, "owner", decideConcessionAward, { awardId: crypto.randomUUID(), decision: "approved" });
    expect(d.ok ? null : d.error.code).toBe("not_found");
    const s = await callAs(a, "accountant", setConcessionRuleActive, { id: crypto.randomUUID(), isActive: false });
    expect(s.ok ? null : s.error.code).toBe("not_found");
  });

  it("an unknown decision value → validation_failed on decision", async () => {
    const d = await callAs(a, "owner", decideConcessionAward, { awardId: crypto.randomUUID(), decision: "maybe" });
    expect(d.ok ? null : d.error.fieldErrors?.decision).toBeTruthy();
  });

  it("owner and principal approving the same award in parallel: exactly one decision lands", async () => {
    const req = await callAs(a, "accountant", requestConcessionAward, { studentId: await freshStudent(), ruleId, reason: "Two siblings enrolled" });
    if (!req.ok) throw new Error(req.error.code);
    const rs = await Promise.all([
      callAs(a, "owner", decideConcessionAward, { awardId: req.data.id, decision: "approved" }),
      callAs(a, "principal", decideConcessionAward, { awardId: req.data.id, decision: "rejected", note: "No proof" }),
    ]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    const loser = rs.find((r) => !r.ok);
    expect(loser && !loser.ok ? loser.error.code : null).not.toBe("internal");
  });

  it("the same student+rule requested twice in parallel leaves one live award, and the loser is not internal", async () => {
    const studentId = await freshStudent();
    const rs = await Promise.all([1, 2].map(() => callAs(a, "accountant", requestConcessionAward, { studentId, ruleId, reason: "Two siblings enrolled" })));
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    const loser = rs.find((r) => !r.ok);
    expect(loser && !loser.ok ? loser.error.code : null).toBe("conflict");
    const [c] = await sql`select count(*)::int as n from public.concession_awards where student_id = ${studentId} and status <> 'rejected'`;
    expect(c.n).toBe(1);
  });

  it("guardian and student are forbidden from every scholarship write", async () => {
    for (const role of ["guardian", "student"] as const) {
      const r1 = await callAs(a, role, saveConcessionRule, { name: "Hack", percent: 50 });
      const r2 = await callAs(a, role, requestConcessionAward, { studentId: await freshStudent(), ruleId, reason: "Please approve" });
      const r3 = await callAs(a, role, decideConcessionAward, { awardId: crypto.randomUUID(), decision: "approved" });
      expect([r1, r2, r3].map((r) => (r.ok ? "ok" : r.error.code))).toEqual(["forbidden", "forbidden", "forbidden"]);
    }
  });
});
