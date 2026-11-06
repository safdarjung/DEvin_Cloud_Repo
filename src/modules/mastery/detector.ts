// M20-T12 — gap detector `mastery_gap_v1` (M20-tasks.md rulings "Gap
// detector", "Interventions", "AI boundary"). Service role only (job
// `mastery.compute`), deterministic, no AI. Acts only on `support` students:
// one insight per (student, window) through M19's writer `record_insights`,
// plus one proposed intervention plan. Never changes an insight's or a plan's
// status. Relative `.ts` value imports: the job runner loads this as plain node.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import {
  DETECTOR_VERSION,
  GAP_THRESHOLD,
  MIN_CONFIDENCE,
  classifyStudent,
  gapConfidence,
  gapEvidence,
  gapPattern,
  gapSeverity,
  gapsFrom,
  proposeIntervention,
  type MasteryGap,
  type MasteryStats,
  type UnitScore,
} from "./rules.ts";

type Admin = SupabaseClient<Database>;
type StatsRow = Database["public"]["Functions"]["mastery_student_stats"]["Returns"][number];
interface Run {
  institutionId: string;
  yearId: string;
  today: string;
  dateFrom: string;
  window: string;
  decidedAt: string;
  createdBy: string;
}
export interface GapDetectorResult {
  created: number;
  refreshed: number;
  plans: number;
}

// Added to M19's signal check by 0093 part 4; M19's detector_version is int (1 = mastery_gap_v1).
const SIGNAL = "academics.mastery_gap";
const SIGNAL_VERSION = 1;
const PAGE = 1000; // PostgREST max rows
const BATCH = 150; // support students per batch: keeps `.in()` URLs short (finance/actions.ts precedent)
const DEFAULT_TZ = "Asia/Kolkata";
const OPEN_STATUSES = ["new", "reviewing"];

export async function runMasteryGapDetector(
  admin: Admin,
  institutionId: string,
  now = new Date(),
): Promise<GapDetectorResult> {
  const totals = { created: 0, refreshed: 0, plans: 0 };
  const base = await loadRun(admin, institutionId, now);
  if (!base) return totals;

  const support = (await loadStats(admin, base.yearId)).filter(
    (row) => classifyStudent(toStats(row), { trend: "flat", attendancePct: null, hasActivePlan: false }).risk === "support",
  );
  if (support.length === 0) return totals;

  const run = { ...base, createdBy: await planAuthor(admin, institutionId) };
  for (let i = 0; i < support.length; i += BATCH) {
    const result = await runBatch(admin, run, support.slice(i, i + BATCH));
    totals.created += result.created;
    totals.refreshed += result.refreshed;
    totals.plans += result.plans;
  }
  return totals;
}

function toStats(row: StatsRow): MasteryStats {
  return {
    gapUnits: row.gap_units,
    confidentUnits: row.confident_units,
    meanScore: row.mean_score === null ? null : Number(row.mean_score),
  };
}

function dedupeKey(studentId: string, window: string): string {
  return `${SIGNAL}:student:${studentId}:${window}`;
}

/** Year, institution-local today and window (term containing today, else latest started term, else the year). */
async function loadRun(admin: Admin, institutionId: string, now: Date): Promise<Omit<Run, "createdBy"> | null> {
  const [institution, year] = await Promise.all([
    admin.from("institutions").select("settings").eq("id", institutionId).single(),
    admin
      .from("academic_years")
      .select("id, starts_on")
      .eq("institution_id", institutionId)
      .eq("is_current", true)
      .maybeSingle(),
  ]);
  if (institution.error) throw institution.error;
  if (year.error) throw year.error;
  if (!year.data) return null;

  const tz = (institution.data.settings as { locale?: { timezone?: unknown } } | null)?.locale?.timezone;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: typeof tz === "string" && tz.length > 0 ? tz : DEFAULT_TZ,
  }).format(now);

  const { data: terms, error } = await admin
    .from("terms")
    .select("id, ends_on")
    .eq("academic_year_id", year.data.id)
    .lte("starts_on", today)
    .order("starts_on", { ascending: false });
  if (error) throw error;
  const term = terms.find((t) => t.ends_on >= today) ?? terms[0];

  return {
    institutionId,
    yearId: year.data.id,
    today,
    // insights check: date_from <= date_to (a current year that starts after today).
    dateFrom: year.data.starts_on <= today ? year.data.starts_on : today,
    window: term?.id ?? year.data.id,
    decidedAt: now.toISOString(),
  };
}

async function loadStats(admin: Admin, yearId: string): Promise<StatsRow[]> {
  const rows: StatsRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .rpc("mastery_student_stats", {
        p_academic_year_id: yearId,
        // Generated Args type is non-nullable; the SQL function reads null as "all sections".
        p_class_section_id: null as unknown as string,
        p_gap_threshold: GAP_THRESHOLD,
        p_min_confidence: MIN_CONFIDENCE,
      })
      .order("student_id")
      .order("class_section_id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

/** `insight_actions.created_by` is a not-null profile: the detector has no actor, so the earliest active owner, else principal (the demo roster has no owner). */
async function planAuthor(admin: Admin, institutionId: string): Promise<string> {
  const { data, error } = await admin
    .from("memberships")
    .select("user_id")
    .eq("institution_id", institutionId)
    .in("role", ["owner", "principal"])
    .eq("status", "active")
    .order("role") // 'owner' < 'principal'
    .order("created_at")
    .order("user_id")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("mastery gap detector: institution has no active owner or principal");
  return data.user_id;
}

async function loadGaps(admin: Admin, yearId: string, studentIds: string[]): Promise<Map<string, MasteryGap[]>> {
  const units = new Map<string, UnitScore[]>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("mastery_snapshots")
      .select("student_id, score, confidence, subjects(name), curriculum_units(title, sequence)")
      .eq("academic_year_id", yearId)
      .in("student_id", studentIds)
      .gte("confidence", MIN_CONFIDENCE)
      .lt("score", GAP_THRESHOLD)
      .order("student_id")
      .order("curriculum_unit_id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const row of data) {
      const list = units.get(row.student_id) ?? [];
      list.push({
        subject: row.subjects?.name ?? "",
        topic: row.curriculum_units?.title ?? "",
        sequence: row.curriculum_units?.sequence ?? 0,
        score: row.score,
        confidence: row.confidence,
      });
      units.set(row.student_id, list);
    }
    if (data.length < PAGE) break;
  }
  return new Map([...units].map(([studentId, list]) => [studentId, gapsFrom(list)]));
}

async function runBatch(admin: Admin, run: Run, batch: StatsRow[]): Promise<GapDetectorResult> {
  const studentIds = batch.map((row) => row.student_id);
  const sectionIds = [...new Set(batch.map((row) => row.class_section_id))];

  const [gapsByStudent, existing, sections] = await Promise.all([
    loadGaps(admin, run.yearId, studentIds),
    admin
      .from("insights")
      .select(
        "status, institution_id, signal, detector_version, dedupe_key, domain, kind, severity, title, pattern, evidence, sources, date_from, date_to, confidence, factors, reviewer_role, recommended_actions, approval_required, entity_type, entity_id, entity_label, class_section_id",
      )
      .eq("institution_id", run.institutionId)
      .eq("signal", SIGNAL)
      .in("entity_id", studentIds)
      .like("dedupe_key", `%:${run.window}`),
    admin
      .from("class_sections")
      .select("id, class_teacher_id, staff!class_sections_class_teacher_id_fkey(full_name)")
      .in("id", sectionIds),
  ]);
  if (existing.error) throw existing.error;
  if (sections.error) throw sections.error;
  const existingByKey = new Map(existing.data.map((row) => [row.dedupe_key, row]));
  const sectionById = new Map(sections.data.map((row) => [row.id, row]));

  const inserts: Json[] = [];
  const refreshes: Omit<(typeof existing.data)[number], "status">[] = [];
  const targets = new Map<string, { row: StatsRow; stats: MasteryStats; gaps: MasteryGap[] }>();
  for (const row of batch) {
    const stats = toStats(row);
    const gaps = gapsByStudent.get(row.student_id) ?? [];
    const key = dedupeKey(row.student_id, run.window);
    const fresh = {
      severity: gapSeverity(stats),
      pattern: gapPattern(stats),
      evidence: gapEvidence(stats, gaps),
      confidence: gapConfidence(stats),
      date_to: run.today,
    };
    const prior = existingByKey.get(key);
    if (!prior) {
      inserts.push({
        signal: SIGNAL,
        detector_version: SIGNAL_VERSION,
        dedupe_key: key,
        domain: "academics",
        kind: "diagnostic",
        title: "Learning gaps need support",
        sources: ["mastery.gapsForStudent"],
        date_from: run.dateFrom,
        factors: [],
        reviewer_role: "teacher",
        recommended_actions: [
          "Review the proposed intervention plan",
          "Re-teach the weakest units",
          "Re-assess after the plan's review date",
        ],
        approval_required: true,
        entity_type: "student",
        entity_id: row.student_id,
        entity_label: null, // M19 check: never stored for students; the read path resolves the name
        class_section_id: row.class_section_id,
        ...fresh,
      });
    } else {
      const { status, ...stored } = prior;
      if (!OPEN_STATUSES.includes(status)) continue; // actioned / resolved / dismissed: untouched, nothing new this window
      refreshes.push({ ...stored, ...fresh });
    }
    targets.set(key, { row, stats, gaps });
  }

  let created = 0;
  if (inserts.length > 0) {
    // M19's writer: status 'new', on conflict do nothing (dedupe key, or an open one from an older window).
    const { data, error } = await admin.rpc("record_insights", { p_institution_id: run.institutionId, p_rows: inserts });
    if (error) throw error;
    created = Number(data ?? 0);
  }
  if (refreshes.length > 0) {
    // Upsert keyed on the dedupe unique: every column but the five refreshed ones is the stored value, status is
    // never sent. shortcut: a status change between the read above and this write still gets fresh evidence;
    // move to a set-based SQL refresh if that ever matters.
    const { error } = await admin
      .from("insights")
      .upsert(refreshes, { onConflict: "institution_id,dedupe_key" });
    if (error) throw error;
  }
  if (targets.size === 0) return { created, refreshed: refreshes.length, plans: 0 };

  const plans = await insertPlans(admin, run, targets, sectionById);
  return { created, refreshed: refreshes.length, plans };
}

async function insertPlans(
  admin: Admin,
  run: Run,
  targets: Map<string, { row: StatsRow; stats: MasteryStats; gaps: MasteryGap[] }>,
  sectionById: Map<string, { class_teacher_id: string | null; staff: { full_name: string } | null }>,
): Promise<number> {
  const { data: insights, error } = await admin
    .from("insights")
    .select("id, dedupe_key, insight_actions(kind)")
    .eq("institution_id", run.institutionId)
    .eq("signal", SIGNAL)
    .in(
      "entity_id",
      [...targets.values()].map((t) => t.row.student_id),
    )
    .like("dedupe_key", `%:${run.window}`)
    .in("status", OPEN_STATUSES);
  if (error) throw error;

  const plans = insights.flatMap((insight) => {
    const target = targets.get(insight.dedupe_key);
    if (!target || insight.insight_actions.some((action) => action.kind === "intervention")) return [];
    const { row, stats, gaps } = target;
    const section = sectionById.get(row.class_section_id);
    const proposal = proposeIntervention(gaps, run.today);
    const overall = stats.meanScore === null ? "n/a" : `${Math.round(stats.meanScore * 100)}%`;
    return [
      {
        institution_id: run.institutionId,
        insight_id: insight.id,
        kind: "intervention",
        student_id: row.student_id,
        action: "Intervention plan",
        owner: section?.staff?.full_name.slice(0, 80) ?? "Unassigned",
        owner_staff_id: section?.class_teacher_id ?? null,
        rationale: `${DETECTOR_VERSION}: ${stats.gapUnits} gap units, overall ${overall}`,
        expected_outcome: "Listed units at or above 60% mastery",
        decided_at: run.decidedAt,
        status: "planned", // T6's guard re-derives it: initial unless closed
        goal: proposal.goal,
        steps: proposal.steps,
        review_date: proposal.reviewDate,
        intervention_status: "proposed",
        created_by: run.createdBy,
      },
    ];
  });
  if (plans.length === 0) return 0;

  // Plain insert: PostgREST can't target the partial unique `insight_actions_one_intervention`; the
  // embed above skips insights that already have a plan, and a concurrent duplicate fails (23505) → job retry.
  const { error: insertError } = await admin.from("insight_actions").insert(plans);
  if (insertError) throw insertError;
  return plans.length;
}
