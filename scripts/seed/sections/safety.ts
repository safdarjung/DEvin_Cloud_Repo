import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";

// Features-18 #21 — demo safety alerts: one closed fire drill from last week
// (acknowledged by every demo login, full headcount for every current-year
// section) and one closed rain closure. Deliberately NO active alert: an open
// emergency in the demo would alarm every viewer. Service-role inserts bypass
// the definers, so created_by / closed_by / user_id / marked_by are set here;
// no notify job is enqueued for seeded rows. Dates are relative to the run day
// (like school-labs); ids are fixed; no ctx.rng draws.

const DAY_MS = 86_400_000;
const isoDay = (offset: number) => new Date(Math.floor(Date.now() / DAY_MS) * DAY_MS + offset * DAY_MS).toISOString().slice(0, 10);
const at = (dayOffset: number, hhmm: string, plusMinutes = 0) =>
  new Date(Date.parse(`${isoDay(dayOffset)}T${hhmm}:00+05:30`) + plusMinutes * 60_000).toISOString();

const ACK_LOGINS = [
  "principal",
  "admin",
  "teacher.vi-a",
  "teacher.viii-b",
  "teacher.x-a",
  "admissions",
  "accountant",
  "examcontroller",
  "guardian.one",
  "guardian.two",
  "student.one",
] as const;

const SECTION_TEACHER: Record<string, string> = { "VI-A": "teacher.vi-a", "VIII-B": "teacher.viii-b", "X-A": "teacher.x-a" };

export async function run(ctx: SeedContext): Promise<void> {
  const login = (key: string) => {
    const id = ctx.userIdByLogin[key];
    if (!id) throw new Error(`safety: demo login ${key} not seeded`);
    return id;
  };
  const principal = login("principal");
  const adminUser = login("admin");

  const drillId = uuidV5("safety", "alert:fire-drill");
  const closureId = uuidV5("safety", "alert:rain-closure");
  const drillAt = at(-7, "10:30");
  const closureAt = at(-12, "16:00");

  await insertBatch(ctx.admin, "safety_alerts", [
    {
      id: drillId,
      institution_id: ctx.institutionId,
      kind: "drill",
      title: "Fire evacuation drill",
      message:
        "This is a practice drill. When the long bell rings, leave by your class's marked route and assemble on the main ground. Class teachers take the roll at the assembly point and report the headcount.",
      audience: "all",
      status: "closed",
      created_by: principal,
      created_at: drillAt,
      closed_at: at(-7, "10:30", 28),
      closed_by: principal,
    },
    {
      id: closureId,
      institution_id: ctx.institutionId,
      kind: "closure",
      title: "School closed tomorrow: heavy rain",
      message:
        "Because of heavy rain and waterlogging on the approach roads, the school will stay closed tomorrow. Worksheets will be shared in the class diary. Classes resume the day after.",
      audience: "all",
      status: "closed",
      created_by: adminUser,
      created_at: closureAt,
      closed_at: at(-10, "18:00"),
      closed_by: adminUser,
    },
  ]);

  const acks = [
    ...ACK_LOGINS.map((key, i) => ({
      id: uuidV5("safety", `ack:drill:${key}`),
      institution_id: ctx.institutionId,
      alert_id: drillId,
      user_id: login(key),
      created_at: at(-7, "10:30", 1 + i),
    })),
    ...ACK_LOGINS.slice(0, 8).map((key, i) => ({
      id: uuidV5("safety", `ack:closure:${key}`),
      institution_id: ctx.institutionId,
      alert_id: closureId,
      user_id: login(key),
      created_at: at(-12, "16:00", 5 + i * 7),
    })),
  ];
  await insertBatch(ctx.admin, "safety_acknowledgements", acks);

  // Full drill headcount: every current-year section, sized from its seeded roster.
  const { data: sections, error } = await ctx.admin
    .from("class_sections")
    .select("id, name, grades(code, sort_key)")
    .eq("institution_id", ctx.institutionId)
    .eq("academic_year_id", ctx.academicYearId)
    .order("id");
  if (error) throw new Error(`safety: class_sections query failed: ${error.message}`);
  const ordered = ((sections ?? []) as unknown as { id: string; name: string; grades: { code: string; sort_key: number } | null }[])
    .map((s) => ({ id: s.id, key: `${s.grades?.code ?? "?"}-${s.name}`, sort: s.grades?.sort_key ?? 0 }))
    .sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
  if (ordered.length === 0) throw new Error("safety: no class sections seeded");

  const headcounts = ordered.map((s, i) => {
    const roster = ctx.studentsBySection[s.key]?.length ?? 0;
    const missing = i % 9 === 4 && roster > 0 ? 1 : 0;
    return {
      id: uuidV5("safety", `headcount:drill:${s.key}`),
      institution_id: ctx.institutionId,
      alert_id: drillId,
      class_section_id: s.id,
      present_count: roster - missing,
      missing_count: missing,
      note: missing ? "One student at the sick bay, confirmed by the nurse." : null,
      marked_by: login(SECTION_TEACHER[s.key] ?? (i % 2 === 0 ? "principal" : "admin")),
      created_at: at(-7, "10:30", 8 + (i % 15)),
      updated_at: at(-7, "10:30", 8 + (i % 15)),
    };
  });
  await insertBatch(ctx.admin, "safety_headcounts", headcounts);
}
