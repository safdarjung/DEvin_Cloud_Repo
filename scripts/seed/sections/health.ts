import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";

// Features-18 #5 — demo health profiles, infirmary visits, vaccinations.
// Fully deterministic (fixed uuidV5 ids, cyclic picks, no ctx.rng draws) so no
// other section's PRNG sequence moves. Registered after people/core.
const BLOOD = ["A+", "B+", "O+", "AB+", "O-", "A-", "B-", "O+"] as const;
const ALLERGIES = [null, "Peanuts", null, "Dust", "Penicillin", null, null, "Egg"] as const;
const CONDITIONS = [null, null, "Mild asthma", null, null, "Type 1 diabetes (monitored)", null, null] as const;
const COMPLAINTS = ["Headache", "Stomach ache", "Minor cut on knee", "Fever", "Nosebleed", "Dizziness after PT", "Sprained ankle", "Sore throat"] as const;
const TREATMENTS = ["Rest and water", "Antacid as per guardian consent", "Wound cleaned and dressed", "Temperature checked, guardian called", "Cold compress", "Rest, glucose water", "Ice pack and crepe bandage", "Warm saline gargle"] as const;
const OUTCOMES = ["returned_to_class", "rested", "sent_home", "returned_to_class", "returned_to_class", "rested", "referred", "returned_to_class"] as const;
const VACCINES = [
  ["MMR", "Dose 1"],
  ["Hepatitis B", "Dose 3"],
  ["Typhoid conjugate", "Single"],
  ["Tdap booster", "Booster"],
] as const;
const STUDENT_COUNT = 30;

export async function run(ctx: SeedContext): Promise<void> {
  const adminUserId = ctx.userIdByLogin["admin"]!;
  const students = Object.keys(ctx.studentsBySection)
    .sort()
    .flatMap((k) => ctx.studentsBySection[k]!)
    .slice(0, STUDENT_COUNT);
  if (students.length === 0) return;

  const profiles = students.map((s, i) => ({
    id: uuidV5("health", `profile:${s.id}`),
    institution_id: ctx.institutionId,
    student_id: s.id,
    blood_group: BLOOD[i % BLOOD.length]!,
    allergies: ALLERGIES[i % ALLERGIES.length]!,
    conditions: CONDITIONS[i % CONDITIONS.length]!,
    emergency_note: i % 5 === 0 ? "Call guardian first, then the family doctor." : null,
  }));
  await insertBatch(ctx.admin, "health_profiles", profiles);

  const visits = students.slice(0, 24).map((s, i) => ({
    id: uuidV5("health", `visit:${s.id}`),
    institution_id: ctx.institutionId,
    student_id: s.id,
    visited_at: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T${String(9 + (i % 6)).padStart(2, "0")}:15:00+05:30`,
    complaint: COMPLAINTS[i % COMPLAINTS.length]!,
    treatment: TREATMENTS[i % TREATMENTS.length]!,
    outcome: OUTCOMES[i % OUTCOMES.length]!,
    recorded_by: adminUserId,
  }));
  await insertBatch(ctx.admin, "health_visits", visits);

  const vaccinations = students.flatMap((s, i) =>
    VACCINES.slice(0, 1 + (i % VACCINES.length)).map(([vaccine, dose], j) => ({
      id: uuidV5("health", `vax:${s.id}:${j}`),
      institution_id: ctx.institutionId,
      student_id: s.id,
      vaccine,
      dose,
      administered_on: `20${19 + j}-0${1 + (i % 9)}-1${j}`,
      notes: null,
      recorded_by: adminUserId,
    })),
  );
  await insertBatch(ctx.admin, "vaccinations", vaccinations);
}
