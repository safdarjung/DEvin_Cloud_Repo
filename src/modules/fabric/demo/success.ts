import { StudentSuccessRow, InterventionPlan } from "@/modules/fabric/types";
import {
  rng,
  FixtureOpts,
  isoDate,
  addDays,
  INDIAN_FIRST_NAMES,
  INDIAN_LAST_NAMES,
  SECTION_LABELS,
  SUBJECTS,
} from "./prng";

export function studentSuccessRows(opts: FixtureOpts): StudentSuccessRow[] {
  const r = rng(opts.seed);
  const rows: StudentSuccessRow[] = [];

  for (let i = 0; i < 60; i++) {
    const section = r.pick(SECTION_LABELS);
    // Risk distribution: 70% none, 20% watch, 10% support
    const riskRoll = r.next();
    const risk: "none" | "watch" | "support" =
      riskRoll < 0.7 ? "none" : riskRoll < 0.9 ? "watch" : "support";

    const gapCount = risk === "none" ? 0 : r.int(1, 3);
    const gaps = [];
    for (let g = 0; g < gapCount; g++) {
      gaps.push({
        subject: r.pick(SUBJECTS),
        topic: `Topic ${g + 1}`,
        mastery_pct: r.int(30, 70),
      });
    }

    const lastContactDays =
      risk === "none" ? null : r.int(0, 45);

    rows.push({
      student_id: r.id("stu", 1000 + i),
      name: `${r.pick(INDIAN_FIRST_NAMES)} ${r.pick(INDIAN_LAST_NAMES)}`,
      section_label: section,
      attendance_pct: r.int(75, 100),
      mastery_pct: r.int(50, 100),
      trend: r.pick(["up", "flat", "down"] as const),
      risk,
      support_owner: risk === "none" ? null : r.pick(["Ms. Sharma", "Mr. Gupta"]),
      last_contact:
        lastContactDays === null
          ? null
          : isoDate(addDays(opts.now, -lastContactDays)),
      flags: risk === "watch" ? ["Low mastery"] : risk === "support" ? ["Intervention active"] : [],
      gaps,
    });
  }

  return rows;
}

export function interventionPlans(opts: FixtureOpts): InterventionPlan[] {
  const r = rng(opts.seed);
  const students = studentSuccessRows(opts).filter((s) => s.risk === "support");
  const plans: InterventionPlan[] = [];

  const selected = students.slice(0, Math.min(8, students.length));

  for (let i = 0; i < selected.length; i++) {
    const stepCount = r.int(3, 4);
    const steps = [];
    for (let s = 0; s < stepCount; s++) {
      steps.push({
        title: `Step ${s + 1}: ${["Assessment", "Tutoring", "Revision", "Test"][s] || "Follow-up"}`,
        due: isoDate(addDays(opts.now, r.int(7, 60))),
        done: r.chance(0.4),
      });
    }

    plans.push({
      id: r.id("plan", 5000 + i),
      student_id: selected[i]!.student_id,
      owner: selected[i]!.support_owner || "Ms. Sharma",
      goal: `Support ${selected[i]!.name} to improve mastery`,
      steps,
      status: r.pick(["proposed", "active", "review", "closed"] as const),
      review_date: isoDate(addDays(opts.now, r.int(14, 90))),
      restricted: true,
    });
  }

  return plans;
}
