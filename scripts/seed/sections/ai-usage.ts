import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";
import { demoUsers, dayStart, insertOnce, pick, sectionRng } from "../lib/util.ts";
import { estimateCost } from "../../../src/lib/ai/pricing.ts";

// ~420 metadata-only events over 30 days. The demo institution is `ai_policy = local_only`
// (core.ts), so every call ran on the local model and cost is 0 (pricing.ts: local is free);
// seeding cloud rows would contradict the policy. Features, roles and error codes are the ones
// the gateway/usage code produces: quota_exceeded and rate_limited come from checkLimits,
// ai_unavailable and ai_invalid_output from the gateway. No prompt or output text is stored.

const LOCAL_MODEL = "qwen3:4b-instruct-2507-q4_K_M";
type Role = "teacher" | "principal" | "admin" | "admissions" | "accountant" | "exam_controller" | "student" | "guardian";

interface FeatureDef {
  feature: string;
  weight: number;
  roles: readonly [Role, ...Role[]];
  tokens: readonly [number, number, number, number]; // input min/max, output min/max
  latencyMs: readonly [number, number];
  pii?: boolean; // prompts may include names, so the redactor sometimes fires
}

const FEATURES: readonly FeatureDef[] = [
  { feature: "teacher_agent", weight: 14, roles: ["teacher"], tokens: [900, 3200, 150, 700], latencyMs: [3000, 16000] },
  { feature: "student_study", weight: 14, roles: ["student"], tokens: [700, 2600, 200, 900], latencyMs: [3500, 18000] },
  { feature: "guardian_chat", weight: 5, roles: ["guardian"], tokens: [500, 1800, 120, 500], latencyMs: [2500, 11000] },
  { feature: "practice_quiz", weight: 7, roles: ["student"], tokens: [500, 1200, 700, 1800], latencyMs: [9000, 30000] },
  { feature: "quiz_generation", weight: 6, roles: ["teacher"], tokens: [500, 1400, 800, 2000], latencyMs: [9000, 32000] },
  { feature: "lesson_plan_draft", weight: 5, roles: ["teacher"], tokens: [400, 1100, 700, 1700], latencyMs: [8000, 28000] },
  { feature: "question_paper_draft", weight: 3, roles: ["teacher", "exam_controller"], tokens: [600, 1500, 1200, 2800], latencyMs: [14000, 40000] },
  { feature: "result_remark_draft", weight: 5, roles: ["teacher"], tokens: [300, 800, 80, 220], latencyMs: [1800, 7000], pii: true },
  { feature: "ptm_brief", weight: 3, roles: ["teacher"], tokens: [500, 1300, 200, 600], latencyMs: [3000, 11000], pii: true },
  { feature: "substitution_note", weight: 2, roles: ["admin"], tokens: [200, 500, 60, 160], latencyMs: [1200, 4500] },
  { feature: "translate", weight: 4, roles: ["teacher", "admin"], tokens: [150, 900, 150, 950], latencyMs: [2000, 9000] },
  { feature: "dashboard_briefing", weight: 5, roles: ["principal", "admin"], tokens: [900, 2200, 200, 450], latencyMs: [4000, 13000] },
  { feature: "insight_explain", weight: 4, roles: ["principal", "admin"], tokens: [500, 1400, 150, 400], latencyMs: [2500, 9000] },
  { feature: "attendance_pattern_insight", weight: 2, roles: ["principal", "admin"], tokens: [600, 1600, 150, 400], latencyMs: [3000, 10000] },
  { feature: "enquiry_reply_draft", weight: 3, roles: ["admissions"], tokens: [250, 700, 120, 320], latencyMs: [2000, 7000], pii: true },
  { feature: "fee_reminder_draft", weight: 2, roles: ["accountant"], tokens: [200, 500, 100, 260], latencyMs: [1600, 5500] },
  { feature: "helpdesk_triage", weight: 2, roles: ["admin"], tokens: [250, 800, 40, 120], latencyMs: [1200, 4000] },
  { feature: "form_draft", weight: 2, roles: ["admin", "principal"], tokens: [300, 800, 400, 1100], latencyMs: [5000, 16000] },
  { feature: "import_mapping", weight: 1, roles: ["admin"], tokens: [400, 1200, 150, 500], latencyMs: [2500, 8000] },
  { feature: "studio_proposal", weight: 1, roles: ["principal", "admin"], tokens: [900, 2000, 900, 2200], latencyMs: [15000, 42000] },
  { feature: "website_page_draft", weight: 3, roles: ["admin", "principal"], tokens: [500, 1400, 900, 2400], latencyMs: [12000, 38000] },
  { feature: "website_theme_draft", weight: 1, roles: ["admin"], tokens: [250, 600, 200, 500], latencyMs: [3500, 10000] },
  { feature: "lab_scenario", weight: 2, roles: ["teacher"], tokens: [300, 800, 300, 900], latencyMs: [5000, 16000] },
  { feature: "lab_safety_note", weight: 1, roles: ["teacher"], tokens: [250, 600, 150, 450], latencyMs: [3000, 9000] },
  { feature: "lab_explain", weight: 1, roles: ["teacher", "student"], tokens: [250, 700, 200, 600], latencyMs: [3000, 10000] },
];

const ERRORS = [
  { code: "ai_unavailable", weight: 3, quick: false },
  { code: "ai_invalid_output", weight: 3, quick: false },
  { code: "rate_limited", weight: 2, quick: true },
  { code: "quota_exceeded", weight: 1, quick: true },
] as const;

const between = (rng: () => number, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

function weighted<T extends { weight: number }>(rng: () => number, items: readonly T[]): T {
  let n = rng() * items.reduce((s, i) => s + i.weight, 0);
  for (const item of items) if ((n -= item.weight) < 0) return item;
  return items[items.length - 1]!;
}

export async function run(ctx: SeedContext): Promise<void> {
  const inst = ctx.institutionId;
  const rng = sectionRng("ai-usage");
  const users = await demoUsers(ctx.sql, inst);
  const userByRole: Record<Role, string[]> = {
    teacher: ["teacher.vi-a", "teacher.viii-b", "teacher.x-a"].map((k) => users[k]!),
    principal: [users["principal"]!],
    admin: [users["admin"]!],
    admissions: [users["admissions"]!],
    accountant: [users["accountant"]!],
    exam_controller: [users["examcontroller"]!],
    student: [users["student.one"]!],
    guardian: [users["guardian.one"]!, users["guardian.two"]!],
  };

  const rows = [];
  // Full past days only, so a rerun on the same date generates the same rows.
  for (let day = -30; day <= -1; day++) {
    const dow = dayStart(day).getUTCDay();
    const base = dow === 0 ? 3 : dow === 6 ? 7 : 16;
    const count = base + between(rng, -2, 4);
    for (let i = 0; i < count; i++) {
      const def = weighted(rng, FEATURES);
      const role = pick(rng, def.roles);
      // School hours 08:00-17:30 IST, with a student evening bump.
      const evening = role === "student" && rng() < 0.4;
      const minuteOfDay = (evening ? 18 * 60 + 30 : 2 * 60 + 30) + between(rng, 0, evening ? 210 : 570); // UTC
      const createdAt = new Date(dayStart(day).getTime() + minuteOfDay * 60_000 + between(rng, 0, 59) * 1000);

      const failed = rng() < 0.06;
      const err = failed ? weighted(rng, ERRORS) : null;
      const quick = err?.quick ?? false;
      const input = quick ? 0 : between(rng, def.tokens[0], def.tokens[1]);
      const output = quick || (failed && err?.code === "ai_unavailable") ? 0 : between(rng, def.tokens[2], def.tokens[3]);
      rows.push({
        id: uuidV5("ai-usage", `${inst}:${day}:${i}`),
        institution_id: inst,
        user_id: pick(rng, userByRole[role]),
        role,
        feature: def.feature,
        provider: "local",
        model: LOCAL_MODEL,
        input_tokens: input,
        output_tokens: output,
        latency_ms: quick ? between(rng, 8, 40) : between(rng, def.latencyMs[0], def.latencyMs[1]) * (failed ? 2 : 1),
        cost_estimate_usd: estimateCost("local", LOCAL_MODEL, input, output),
        ok: !failed,
        error_code: err?.code ?? null,
        redactions: def.pii && !quick && rng() < 0.45 ? between(rng, 1, 3) : 0,
        created_at: createdAt.toISOString(),
      });
    }
  }
  await insertOnce(ctx.admin, "ai_usage_events", rows);
}
