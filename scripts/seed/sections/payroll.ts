import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";

// Features-18 #3 — demo payroll (migration 0124): 30 salary structures
// (the 8 staff demo logins + 22 more teachers), two finalized months
// (Aug, Sep 2026) and one draft (Oct 2026) with one payslip per structure.
// Fully deterministic (uuidV5 ids, fixed amounts/timestamps, no ctx.rng
// draws). Service-role client: created_by is passed explicitly (its default
// app.current_user_id() is null here), finalized runs carry finalized_at
// (payroll_runs_finalized_check), and payslips may go straight into a
// finalized run only because app.guard_payslips_write trusts service_role.
// No statutory deductions (PF/ESI/TDS) — the module is <LimitedBadge />.

const RUPEE = 100;
const EXTRA_TEACHERS = 22;
/** Teachers (by index into the teacher list) who got a raise effective October. */
const OCTOBER_RAISE = new Set([0, 1, 2]);

const LOGIN_BASIC: Record<string, number> = {
  principal: 72_000,
  admin: 30_000,
  admissions: 26_000,
  accountant: 34_000,
  examcontroller: 38_000,
};

type Component = { name: string; kind: "earning" | "deduction"; amount_paise: number };

function components(basicRupees: number, i: number): Component[] {
  const rows: Component[] = [
    { name: "Basic", kind: "earning", amount_paise: basicRupees * RUPEE },
    { name: "HRA", kind: "earning", amount_paise: Math.round(basicRupees * 0.4) * RUPEE },
    { name: "Special allowance", kind: "earning", amount_paise: Math.round(basicRupees * 0.1) * RUPEE },
    { name: "Conveyance", kind: "earning", amount_paise: 1_600 * RUPEE },
  ];
  if (i % 5 === 3) rows.push({ name: "Salary advance recovery", kind: "deduction", amount_paise: 2_000 * RUPEE });
  if (i % 7 === 4) rows.push({ name: "Staff quarters rent", kind: "deduction", amount_paise: 3_500 * RUPEE });
  return rows;
}

function totals(rows: Component[]): { gross: number; net: number } {
  const gross = rows.filter((c) => c.kind === "earning").reduce((s, c) => s + c.amount_paise, 0);
  const deductions = rows.filter((c) => c.kind === "deduction").reduce((s, c) => s + c.amount_paise, 0);
  return { gross, net: gross - deductions };
}

export async function run(ctx: SeedContext): Promise<void> {
  const accountantUserId = ctx.userIdByLogin["accountant"]!;

  // [staffId, basic before Oct, basic from Oct]
  const staff: [string, number, number][] = [
    ...Object.entries(LOGIN_BASIC).map(([login, basic]): [string, number, number] => [ctx.linkIdByLogin[login]!, basic, basic]),
    ...ctx.teacherStaffIds.slice(0, 3 + EXTRA_TEACHERS).map((id, t): [string, number, number] => {
      const basic = 28_000 + (t % 8) * 2_000;
      return [id, basic, OCTOBER_RAISE.has(t) ? basic + 3_000 : basic];
    }),
  ];

  const runs = [
    { month: "2026-08-01", status: "finalized", createdAt: "2026-08-28T10:00:00+05:30", finalizedAt: "2026-08-31T17:30:00+05:30" },
    { month: "2026-09-01", status: "finalized", createdAt: "2026-09-28T10:00:00+05:30", finalizedAt: "2026-09-30T17:30:00+05:30" },
    { month: "2026-10-01", status: "draft", createdAt: "2026-10-30T10:00:00+05:30", finalizedAt: null },
  ] as const;

  await insertBatch(
    ctx.admin,
    "payroll_runs",
    runs.map((r) => ({
      id: uuidV5("payroll", `run:${r.month}`),
      institution_id: ctx.institutionId,
      month: r.month,
      status: r.status,
      created_by: accountantUserId,
      created_at: r.createdAt,
      finalized_at: r.finalizedAt,
      finalized_by: r.finalizedAt ? accountantUserId : null,
    })),
  );

  // Current structures = October's (gross_paise is recomputed by the trigger).
  await insertBatch(
    ctx.admin,
    "salary_structures",
    staff.map(([staffId, , octBasic], i) => ({
      id: uuidV5("payroll", `structure:${staffId}`),
      institution_id: ctx.institutionId,
      staff_id: staffId,
      components: components(octBasic, i),
      created_by: accountantUserId,
      created_at: "2026-07-25T10:00:00+05:30",
    })),
  );

  // Payslips snapshot the structure in force that month (pre-raise for Aug/Sep).
  const payslipRows = runs.flatMap((r) =>
    staff.map(([staffId, basic, octBasic], i) => {
      const rows = components(r.month === "2026-10-01" ? octBasic : basic, i);
      const { gross, net } = totals(rows);
      return {
        id: uuidV5("payroll", `payslip:${r.month}:${staffId}`),
        institution_id: ctx.institutionId,
        run_id: uuidV5("payroll", `run:${r.month}`),
        staff_id: staffId,
        components: rows,
        gross_paise: gross,
        net_paise: net,
        created_at: r.createdAt,
      };
    }),
  );
  await insertBatch(ctx.admin, "payslips", payslipRows);
}
