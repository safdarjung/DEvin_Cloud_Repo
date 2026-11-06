import "server-only";
// Dashboard command-center reads. Signed-in user's RLS client only.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { attendanceDailyCounts, getAttendanceSettings, percentageFromCounts, todayInInstitutionTimezone } from "./queries";
import { absentStatusCodes, tallyRepeatedAbsentees, type RepeatedAbsentee } from "./absentees";

export interface SectionAttendanceToday {
  classSectionId: string;
  label: string;
  percentage: number;
  absent: number;
  marked: number;
}

/** Every section with attendance marked today, lowest percentage first, plus the school-wide absent count. */
export async function sectionAttendanceToday(ctx: TenantContext): Promise<{ sections: SectionAttendanceToday[]; absentTotal: number }> {
  const supabase = await createClient();
  const settings = getAttendanceSettings(ctx);
  const absentCodes = new Set(absentStatusCodes(settings.statuses));
  const date = todayInInstitutionTimezone(ctx);

  const rows = await attendanceDailyCounts(ctx, { from: date, to: date, bySection: true });
  const bySection = new Map<string, { status: string; n: number }[]>();
  for (const row of rows) {
    if (!row.classSectionId) continue;
    const entry = bySection.get(row.classSectionId) ?? [];
    entry.push({ status: row.status, n: row.n });
    bySection.set(row.classSectionId, entry);
  }
  if (bySection.size === 0) return { sections: [], absentTotal: 0 };

  const { data, error } = await supabase
    .from("class_sections")
    .select("id, name, grades(code)")
    .eq("institution_id", ctx.institution.id)
    .in("id", Array.from(bySection.keys()));
  if (error) throw error;
  const labelById = new Map((data ?? []).map((s) => [s.id, `${(s.grades as { code: string } | null)?.code ?? "?"}-${s.name}`]));

  let absentTotal = 0;
  const sections = Array.from(bySection.entries())
    .map(([classSectionId, counts]) => {
      const { percentage, totalInDenominator } = percentageFromCounts(counts, settings.statuses);
      const absent = counts.filter((c) => absentCodes.has(c.status)).reduce((t, c) => t + c.n, 0);
      absentTotal += absent;
      return { classSectionId, label: labelById.get(classSectionId) ?? "?", percentage, absent, marked: totalInDenominator };
    })
    .sort((a, b) => a.percentage - b.percentage || a.label.localeCompare(b.label));
  return { sections, absentTotal };
}

function addDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Students with at least `minAbsences` full-day absences in the last `days` calendar days (institution-local). Bounded to 5 pages of 1000 records. */
export async function repeatedAbsentees(ctx: TenantContext, opts: { days?: number; minAbsences?: number; limit?: number } = {}): Promise<RepeatedAbsentee[]> {
  const supabase = await createClient();
  const codes = absentStatusCodes(getAttendanceSettings(ctx).statuses);
  if (codes.length === 0) return [];
  const to = todayInInstitutionTimezone(ctx);
  const from = addDays(to, -((opts.days ?? 14) - 1));

  const collected: { studentId: string; name: string; classSection: string }[] = [];
  const PAGE = 1000;
  for (let start = 0; start < 5 * PAGE; start += PAGE) {
    const { data, error } = await supabase
      .from("attendance_records")
      .select("id, student_id, students(first_name, last_name), attendance_sessions!inner(date, period_id, class_sections(name, grades(code)))")
      .eq("institution_id", ctx.institution.id)
      .in("status", codes)
      .gte("attendance_sessions.date", from)
      .lte("attendance_sessions.date", to)
      .is("attendance_sessions.period_id", null)
      .order("id")
      .range(start, start + PAGE - 1);
    if (error) throw error;
    for (const r of data ?? []) {
      const student = r.students as { first_name: string; last_name: string | null } | null;
      const session = r.attendance_sessions as unknown as { class_sections: { name: string; grades: { code: string } | null } | null } | null;
      collected.push({
        studentId: r.student_id,
        name: [student?.first_name, student?.last_name].filter(Boolean).join(" "),
        classSection: `${session?.class_sections?.grades?.code ?? "?"}-${session?.class_sections?.name ?? "?"}`,
      });
    }
    if (!data || data.length < PAGE) break;
  }
  return tallyRepeatedAbsentees(collected, opts.minAbsences ?? 3, opts.limit ?? 5);
}
