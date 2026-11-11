import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";

// Features-18 #4 — demo behaviour incidents. Registered last: needs people's
// studentsBySection and core's teacher/principal logins. Deterministic (fixed
// uuidV5 ids, index-derived fields, service-role insert), no ctx.rng draws, so
// no other section's PRNG output shifts. 30 incidents over 10 students in
// VI-A and X-A; 2 are voided to show the void path.

const CATALOGUE = [
  { category: "Helpfulness", severity: "low", points: 5, note: "Helped a classmate catch up on the lesson." },
  { category: "Academic effort", severity: "low", points: 10, note: "Strong improvement in the unit test." },
  { category: "Leadership", severity: "medium", points: 15, note: "Led the class cleanliness drive." },
  { category: "Punctuality", severity: "low", points: -2, note: "Late to first period." },
  { category: "Uniform", severity: "low", points: -3, note: "Out of uniform without a note." },
  { category: "Disruption", severity: "medium", points: -8, note: "Disrupted the class after a warning." },
  { category: "Bullying", severity: "high", points: -20, note: "Reported name-calling; parents informed." },
] as const;

const DAYS = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"];

export async function run(ctx: SeedContext): Promise<void> {
  const students = [
    ...[...(ctx.studentsBySection["VI-A"] ?? [])].sort((a, b) => a.firstName.localeCompare(b.firstName)).slice(0, 5),
    ...[...(ctx.studentsBySection["X-A"] ?? [])].sort((a, b) => a.firstName.localeCompare(b.firstName)).slice(0, 5),
  ];
  if (students.length === 0) throw new Error("behaviour: no students seeded");
  const reporters = [ctx.userIdByLogin["teacher.vi-a"]!, ctx.userIdByLogin["principal"]!];
  const voidedBy = ctx.userIdByLogin["principal"]!;

  const rows = Array.from({ length: 30 }, (_, i) => {
    const c = CATALOGUE[(i * 3 + Math.floor(i / 7)) % CATALOGUE.length]!;
    const voided = i === 9 || i === 21;
    return {
      id: uuidV5("behaviour", `incident:${i}`),
      institution_id: ctx.institutionId,
      student_id: students[i % students.length]!.id,
      category: c.category,
      severity: c.severity,
      points: c.points,
      note: c.note,
      occurred_on: DAYS[i % DAYS.length]!,
      reported_by: reporters[i % reporters.length]!,
      voided_at: voided ? "2026-10-31T10:00:00+05:30" : null,
      voided_by: voided ? voidedBy : null,
      void_reason: voided ? "Logged against the wrong student." : null,
    };
  });
  await insertBatch(ctx.admin, "behaviour_incidents", rows);
}
