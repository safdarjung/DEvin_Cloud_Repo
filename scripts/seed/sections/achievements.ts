import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";

// Features-18 #20 — demo achievements. Registered after people/core (needs studentsBySection and
// the principal/teacher logins). Deterministic: fixed uuidV5 ids, index-derived fields, no rng
// draws. recorded_by must be explicit (null under the service role); verified rows carry
// verified_by + verified_at together; 1 voided row shows the void path. 24 rows over 12 students.

const CATALOGUE = [
  { title: "Inter-school chess championship", category: "sports", level: "district", position: "1st", description: "Won all six rounds." },
  { title: "Science exhibition model", category: "academic", level: "school", position: "Runner-up", description: "Working water-purifier model." },
  { title: "State mathematics olympiad", category: "academic", level: "state", position: "Top 50", description: null },
  { title: "Annual day classical dance", category: "arts", level: "school", position: null, description: "Solo performance." },
  { title: "Student council secretary", category: "leadership", level: "school", position: null, description: "Elected by the class." },
  { title: "Tree plantation drive", category: "service", level: "school", position: null, description: "Led a team of 20 students." },
  { title: "Regional 100m sprint", category: "sports", level: "state", position: "3rd", description: null },
  { title: "Inter-school debate", category: "arts", level: "district", position: "Best speaker", description: null },
] as const;

const DATES = ["2026-08-14", "2026-08-29", "2026-09-05", "2026-09-19", "2026-09-26", "2026-10-03", "2026-10-10", "2026-10-17"];

export async function run(ctx: SeedContext): Promise<void> {
  const students = [
    ...[...(ctx.studentsBySection["VI-A"] ?? [])].sort((a, b) => a.firstName.localeCompare(b.firstName)).slice(0, 6),
    ...[...(ctx.studentsBySection["X-A"] ?? [])].sort((a, b) => a.firstName.localeCompare(b.firstName)).slice(0, 6),
  ];
  if (students.length === 0) throw new Error("achievements: no students seeded");
  const recorders = [ctx.userIdByLogin["teacher.vi-a"]!, ctx.userIdByLogin["principal"]!];
  const verifier = ctx.userIdByLogin["principal"]!;

  const rows = Array.from({ length: 24 }, (_, i) => {
    const c = CATALOGUE[(i * 3 + Math.floor(i / 8)) % CATALOGUE.length]!;
    const verified = i % 3 !== 0;
    const voided = i === 17;
    return {
      id: uuidV5("achievements", `achievement:${i}`),
      institution_id: ctx.institutionId,
      student_id: students[i % students.length]!.id,
      title: c.title,
      category: c.category,
      level: c.level,
      position: c.position,
      event_date: DATES[i % DATES.length]!,
      description: c.description,
      recorded_by: recorders[i % recorders.length]!,
      verified_at: verified ? "2026-10-25T10:00:00+05:30" : null,
      verified_by: verified ? verifier : null,
      voided_at: voided ? "2026-10-26T10:00:00+05:30" : null,
      voided_by: voided ? verifier : null,
      void_reason: voided ? "Recorded against the wrong student." : null,
    };
  });
  await insertBatch(ctx.admin, "achievements", rows);
}
