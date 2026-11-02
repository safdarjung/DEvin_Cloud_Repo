// T-043 L1 — attendance burst (08 §6 / 09 Day 15,17). 72 class teachers
// submit ~42-record attendance within a 15-min window; measured here as 72
// concurrent (concurrency 10) submits against the exact DB operations
// `markAttendance`/`submitAttendance` perform (src/modules/attendance/
// actions.ts) — session upsert, records upsert, `submit_attendance` RPC —
// run through a real signed-in supabase-js client so RLS (0006/0014) is
// the same boundary a real request would hit. Never imports the server
// action itself (Next-only `"use server"` + cookie-bound client).
//
// Deviation from the packet's literal "72 class teachers": the seed (05
// §8.1, owned by another lane, not touched here) only creates 3 named
// class-teacher logins (teacher.vi-a/.viii-b/.x-a), not one per section.
// `isClassTeacherOrAdmin` in actions.ts lets owner/principal/admin submit
// for ANY section, so this script authenticates once as the seeded admin
// account and fires the real 72-section x 42-record write volume through
// that one RLS-checked session — same DB path and write load, fewer
// distinct JWTs than the spec's assumption. Documented in the result file.
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { requireLoadTarget, summarize } from "./auth.ts";

const SLUG = "st-josephs-demo";
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "CoolSkool-Demo-2026";
const CONCURRENCY = 10;
const STATUS_CODE = "P";

interface SectionTask {
  classSectionId: string;
  studentIds: string[];
}

async function pool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<number>): Promise<{ latencies: number[]; errors: number }> {
  const latencies: number[] = [];
  let errors = 0;
  let next = 0;

  async function runOne(): Promise<void> {
    while (next < items.length) {
      const item = items[next++];
      try {
        latencies.push(await worker(item));
      } catch {
        errors += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runOne));
  return { latencies, errors };
}

async function main(): Promise<void> {
  requireLoadTarget();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set");

  const supabase = createClient(supabaseUrl, publishableKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: authError } = await supabase.auth.signInWithPassword({ email: "admin@demo.coolskool.test", password: PASSWORD });
  if (authError) throw new Error(`login failed: ${authError.message}`);

  const { data: institution, error: instError } = await supabase.from("institutions").select("id").eq("slug", SLUG).maybeSingle();
  if (instError || !institution) throw new Error(`institution lookup failed: ${instError?.message ?? "not found"}`);
  const institutionId = institution.id as string;

  const { data: sections, error: sectionsError } = await supabase
    .from("class_sections")
    .select("id")
    .eq("institution_id", institutionId);
  if (sectionsError) throw new Error(`class_sections lookup failed: ${sectionsError.message}`);

  // PostgREST defaults to a 1,000-row page — 3,024 active enrolments need
  // explicit paging or this silently truncates to ~24 of the 72 sections.
  const enrolments: Array<{ class_section_id: string; student_id: string }> = [];
  const PAGE_SIZE = 1000;
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page, error: enrolError } = await supabase
      .from("enrolments")
      .select("class_section_id, student_id")
      .eq("institution_id", institutionId)
      .eq("status", "active")
      .range(from, from + PAGE_SIZE - 1);
    if (enrolError) throw new Error(`enrolments lookup failed: ${enrolError.message}`);
    enrolments.push(...(page ?? []));
    if (!page || page.length < PAGE_SIZE) break;
  }

  const studentsBySection = new Map<string, string[]>();
  for (const row of enrolments) {
    const list = studentsBySection.get(row.class_section_id) ?? [];
    list.push(row.student_id);
    studentsBySection.set(row.class_section_id, list);
  }

  const tasks: SectionTask[] = (sections ?? [])
    .map((s) => ({ classSectionId: s.id as string, studentIds: studentsBySection.get(s.id as string) ?? [] }))
    .filter((t) => t.studentIds.length > 0);

  // Fixed, pre-reset date so reruns in a fresh `demo:reset` tenant don't
  // collide with "already submitted" (actions.ts) — not "today" to avoid
  // the future-date check if clocks differ between laptop and container.
  const date = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);

  async function submitOne(task: SectionTask): Promise<number> {
    const startedAt = Date.now();
    const { data: session, error: sessionError } = await supabase
      .from("attendance_sessions")
      .upsert(
        { institution_id: institutionId, class_section_id: task.classSectionId, date, status: "open" },
        { onConflict: "class_section_id,date,period_id" },
      )
      .select("id")
      .single();
    if (sessionError) throw sessionError;

    const { error: recordsError } = await supabase.from("attendance_records").upsert(
      task.studentIds.map((studentId) => ({
        institution_id: institutionId,
        session_id: session.id,
        student_id: studentId,
        status: STATUS_CODE,
      })),
      { onConflict: "session_id,student_id" },
    );
    if (recordsError) throw recordsError;

    const { error: submitError } = await supabase.rpc("submit_attendance", {
      p_institution_id: institutionId,
      p_session_id: session.id,
    });
    if (submitError) throw submitError;

    return Date.now() - startedAt;
  }

  console.log(`L1: ${tasks.length} section submits (~${tasks[0]?.studentIds.length ?? 0} records each), concurrency ${CONCURRENCY}, date ${date}`);
  const wallStart = Date.now();
  const { latencies, errors } = await pool(tasks, CONCURRENCY, submitOne);
  const wallMs = Date.now() - wallStart;
  const stats = summarize(latencies, errors);

  const result = {
    scenario: "L1 attendance burst",
    sections: tasks.length,
    recordsPerSection: tasks[0]?.studentIds.length ?? 0,
    concurrency: CONCURRENCY,
    wallMs,
    ...stats,
    deviation: "admin session (RLS-bypass role) used for all 72 submits; seed provides only 3 named class-teacher logins, not 72.",
  };

  console.log(JSON.stringify(result, null, 2));
  mkdirSync("scripts/load/out", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(`scripts/load/out/l1-${stamp}.json`, JSON.stringify(result, null, 2));
  writeFileSync(
    `scripts/load/out/l1-${stamp}.md`,
    `# L1 attendance burst\n\n| sections | records/section | concurrency | wall (ms) | p50 (ms) | p95 (ms) | max (ms) | errors |\n` +
      `|---|---|---|---|---|---|---|---|\n` +
      `| ${result.sections} | ${result.recordsPerSection} | ${result.concurrency} | ${result.wallMs} | ${result.p50} | ${result.p95} | ${result.max} | ${result.errors} |\n\n` +
      `Deviation: ${result.deviation}\n`,
  );
}

main().catch((err: unknown) => {
  console.error("load:l1 failed:", err);
  process.exit(1);
});
