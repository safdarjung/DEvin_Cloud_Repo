import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";

// Features-18 #9 — demo concessions (migration 0118): 6 rules (one inactive)
// and 32 awards for the current academic year spread across grades: 18
// approved, 8 pending, 6 rejected. Service-role client, so requested_by is
// passed explicitly (its default app.current_user_id() is null here):
// requests come from the accountant and admin logins; every decision is the
// principal's, never the requester (concession_awards_two_person). Fully
// deterministic (uuidV5 ids, fixed timestamps, no ctx.rng draws). Recorded
// only — nothing here touches invoices or finance's concessions table.

const RULES = [
  { key: "sibling", name: "Sibling concession", criteria: "Second or later child enrolled in the school.", percent: 10, amount_paise: null, is_active: true },
  { key: "staff_ward", name: "Staff ward", criteria: "Child of a current staff member.", percent: 50, amount_paise: null, is_active: true },
  { key: "merit", name: "Merit scholarship", criteria: "Top 3 in the previous year's final exam.", percent: null, amount_paise: 1_000_000, is_active: true },
  { key: "ews", name: "EWS / RTE", criteria: "Economically weaker section with income certificate.", percent: 100, amount_paise: null, is_active: true },
  { key: "hardship", name: "Hardship support", criteria: "Family hardship verified by the principal.", percent: null, amount_paise: 500_000, is_active: true },
  { key: "sports", name: "Sports quota (old)", criteria: "District-level sports representation.", percent: 25, amount_paise: null, is_active: false },
] as const;

const ACTIVE_RULES = RULES.filter((r) => r.is_active);

const REASONS: Record<(typeof RULES)[number]["key"], string> = {
  sibling: "Elder sibling is enrolled in the school this year.",
  staff_ward: "Parent is a full-time teacher at the school.",
  merit: "Ranked in the top 3 of the grade in last year's finals.",
  ews: "Income certificate submitted; family qualifies under EWS.",
  hardship: "Family business closed this year; principal met the guardian.",
  sports: "Represented the district in athletics.",
};

const AWARD_COUNT = 32;
/** Index pattern: 0..17 approved, 18..25 pending, 26..31 rejected. */
function statusOf(i: number): "approved" | "pending" | "rejected" {
  return i < 18 ? "approved" : i < 26 ? "pending" : "rejected";
}

function at(dayOfOctober: number, hour: number): string {
  return `2026-10-${String(dayOfOctober).padStart(2, "0")}T${String(hour).padStart(2, "0")}:15:00+05:30`;
}

export async function run(ctx: SeedContext): Promise<void> {
  const accountant = ctx.userIdByLogin["accountant"]!;
  const admin = ctx.userIdByLogin["admin"]!;
  const principal = ctx.userIdByLogin["principal"]!;

  await insertBatch(
    ctx.admin,
    "concession_rules",
    RULES.map((r) => ({
      id: uuidV5("scholarships", `rule:${r.key}`),
      institution_id: ctx.institutionId,
      name: r.name,
      criteria: r.criteria,
      percent: r.percent,
      amount_paise: r.amount_paise,
      is_active: r.is_active,
    })),
  );

  const sectionKeys = Object.keys(ctx.studentsBySection).sort();
  const awards = Array.from({ length: AWARD_COUNT }, (_, i) => {
    const section = ctx.studentsBySection[sectionKeys[i % sectionKeys.length]!]!;
    const student = section[(Math.floor(i / sectionKeys.length) * 3 + 2) % section.length]!;
    const rule = ACTIVE_RULES[i % ACTIVE_RULES.length]!;
    const status = statusOf(i);
    const requestedAt = at(1 + (i % 28), 10);
    return {
      id: uuidV5("scholarships", `award:${i}`),
      institution_id: ctx.institutionId,
      student_id: student.id,
      academic_year_id: ctx.academicYearId,
      rule_id: uuidV5("scholarships", `rule:${rule.key}`),
      percent: rule.percent,
      amount_paise: rule.amount_paise,
      reason: REASONS[rule.key],
      status,
      requested_by: i % 3 === 0 ? admin : accountant,
      decided_by: status === "pending" ? null : principal,
      decided_at: status === "pending" ? null : at(Math.min(30, 2 + (i % 28)), 16),
      decision_note: status === "rejected" ? "Supporting documents not provided." : status === "approved" && i % 4 === 0 ? "Documents verified." : null,
      created_at: requestedAt,
    };
  });

  await insertBatch(ctx.admin, "concession_awards", awards);
}
