import type { SeedContext } from "../lib/context.ts";
import { insertBatch } from "../lib/batch.ts";
import { uuidV5 } from "../lib/ids.ts";
import { defaultRules } from "../../../src/modules/timetable/rules.ts";

// 0141 demo data for timetable control, insert-if-missing (safe to rerun), no rng:
// - the school's rules row (defaults) + its logged "rules" change;
// - "2026-27 Timetable (April)" archived: the published timetable as it was in
//   April — VI-A Tue P3 in the Hall, Thu P6 free — so Compare shows two
//   differences, and two logged changes on the published version explain them;
// - "Term 2 draft": a copy of the published timetable with VI-A's Wednesday
//   morning cleared (logged), so Plan shows suggestions to apply;
// - a "cover" log row for any seeded substitution that has none (rows written
//   before 0141's trigger existed).

const NS = "timetable-control";
const SECTION = "VI-A";

type Slot = { class_section_id: string; subject_id: string; teacher_id: string; room_id: string | null; weekday: number; period_id: string };

export async function run(ctx: SeedContext): Promise<void> {
  const inst = ctx.institutionId;
  const principal = ctx.userIdByLogin["principal"];
  if (!principal) {
    console.warn("  timetable-control: no principal login; skipped.");
    return;
  }
  const publishedId = uuidV5("timetable", `version:${ctx.academicYearId}`);
  const [published] = await ctx.sql<{ id: string; status: string }[]>`
    select id, status from public.timetable_versions where id = ${publishedId} and institution_id = ${inst}`;
  if (!published) {
    console.warn("  timetable-control: seeded timetable version not found; skipped.");
    return;
  }
  const [{ name: actorName }] = await ctx.sql<{ name: string }[]>`
    select coalesce((select st.full_name from public.memberships m join public.staff st on st.id = m.staff_id
      where m.user_id = ${principal} and m.institution_id = ${inst} limit 1), 'Principal') as name`;

  const sectionId = uuidV5("academics", `section:${SECTION}`);
  const period = (seq: number) => uuidV5("timetable", `period:${seq}`);
  const hall = uuidV5("timetable", "room:hall");
  const slots = await ctx.sql<Slot[]>`
    select class_section_id, subject_id, teacher_id, room_id, weekday, period_id
    from public.timetable_slots where version_id = ${publishedId} order by id`;
  const at = (w: number, seq: number) => slots.find((s) => s.class_section_id === sectionId && s.weekday === w && s.period_id === period(seq));
  const tueP3 = at(2, 3);
  const thuP6 = at(4, 8);
  const wedMorning = [1, 2, 3, 5].map((seq) => at(3, seq)).filter((s): s is Slot => !!s);
  if (!tueP3 || !thuP6) {
    console.warn(`  timetable-control: ${SECTION} has no Tue P3/Thu P6 slot; skipped.`);
    return;
  }
  const names = await ctx.sql<{ kind: string; id: string; name: string }[]>`
    select 'subject' as kind, id, name from public.subjects where institution_id = ${inst}
    union all select 'staff', id, full_name from public.staff where institution_id = ${inst}
    union all select 'room', id, name from public.rooms where institution_id = ${inst}`;
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  const cellJson = (s: Pick<Slot, "subject_id" | "teacher_id" | "room_id">) => ({
    subjectId: s.subject_id,
    subject: nameOf.get(s.subject_id) ?? null,
    teacherId: s.teacher_id,
    teacher: nameOf.get(s.teacher_id) ?? null,
    roomId: s.room_id,
    room: s.room_id ? (nameOf.get(s.room_id) ?? null) : null,
  });
  const label = (w: number, periodName: string) => `${SECTION} · ${["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][w]} · ${periodName}`;
  const base = { institution_id: inst, actor_id: principal, actor_name: actorName };

  // ---- rules ----
  await ctx.sql`
    insert into public.timetable_rules (institution_id, rules, updated_by)
    values (${inst}, ${ctx.sql.json(defaultRules(36) as never)}, ${principal})
    on conflict (institution_id) do nothing`;

  // ---- archived April version (published + two differences) ----
  const aprilId = uuidV5(NS, `version:april:${ctx.academicYearId}`);
  const draftId = uuidV5(NS, `version:term2:${ctx.academicYearId}`);
  const existing = await ctx.sql<{ id: string }[]>`select id from public.timetable_versions where id in (${aprilId}, ${draftId})`;
  const has = new Set(existing.map((r) => r.id));
  const copy = (versionId: string, keep: (s: Slot) => boolean, edit: (s: Slot) => Slot = (s) => s) =>
    // Deterministic ids (rule 11): a reseed must give the same slot ids; one slot per section × weekday × period.
    slots.filter(keep).map((s) => ({
      ...edit(s),
      id: uuidV5(NS, `slot:${versionId}:${s.class_section_id}:${s.weekday}:${s.period_id}`),
      institution_id: inst,
      version_id: versionId,
    }));

  if (!has.has(aprilId)) {
    await ctx.sql`
      insert into public.timetable_versions (id, institution_id, academic_year_id, name, status, published_at, published_by, created_by, created_at)
      values (${aprilId}, ${inst}, ${ctx.academicYearId}, '2026-27 Timetable (April)', 'archived', '2026-04-01T09:00:00+05:30', ${principal}, ${principal}, '2026-03-28T09:00:00+05:30')`;
    await insertBatch(
      ctx.admin,
      "timetable_slots",
      copy(
        aprilId,
        (s) => s !== thuP6,
        (s) => (s === tueP3 ? { ...s, room_id: hall } : s),
      ),
      2000,
    );
  }

  // ---- Term 2 draft (published minus VI-A's Wednesday morning) ----
  if (!has.has(draftId)) {
    await ctx.sql`
      insert into public.timetable_versions (id, institution_id, academic_year_id, name, status, created_by, created_at)
      values (${draftId}, ${inst}, ${ctx.academicYearId}, 'Term 2 draft', 'draft', ${principal}, '2026-09-20T09:00:00+05:30')`;
    await insertBatch(ctx.admin, "timetable_slots", copy(draftId, (s) => !wedMorning.includes(s)), 2000);
  }

  // ---- change log ----
  const periodName = new Map((await ctx.sql<{ id: string; name: string }[]>`select id, name from public.periods where institution_id = ${inst}`).map((p) => [p.id, p.name]));
  const rows: Record<string, unknown>[] = [
    {
      ...base,
      id: uuidV5(NS, "change:rules"),
      kind: "rules",
      action: "rules",
      before: null,
      after: defaultRules(36),
      reason: "Set up the timetable rules with the school's usual limits: at most 2 periods of a subject a day and 36 periods a week per teacher.",
      created_at: "2026-04-02T10:00:00+05:30",
    },
    {
      ...base,
      id: uuidV5(NS, "change:tue-p3-room"),
      version_id: publishedId,
      kind: "manual",
      action: "change",
      class_section_id: sectionId,
      weekday: 2,
      period_id: period(3),
      teacher_id: tueP3.teacher_id,
      prev_teacher_id: tueP3.teacher_id,
      label: label(2, "Period 3"),
      before: cellJson({ ...tueP3, room_id: hall }),
      after: cellJson(tueP3),
      reason: "The Hall is booked for assembly practice on Tuesday mornings, so this class moved back to its own room.",
      created_at: "2026-06-10T10:00:00+05:30",
    },
    {
      ...base,
      id: uuidV5(NS, "change:thu-p6-add"),
      version_id: publishedId,
      kind: "manual",
      action: "add",
      class_section_id: sectionId,
      weekday: 4,
      period_id: period(8),
      teacher_id: thuP6.teacher_id,
      label: label(4, "Period 6"),
      before: null,
      after: cellJson(thuP6),
      reason: "Extra period added after the mid-term review: the class needed more time for this subject.",
      created_at: "2026-07-02T11:30:00+05:30",
    },
    ...wedMorning.map((s) => ({
      ...base,
      id: uuidV5(NS, `change:term2:${s.period_id}`),
      version_id: draftId,
      kind: "manual",
      action: "remove",
      class_section_id: sectionId,
      weekday: 3,
      period_id: s.period_id,
      prev_teacher_id: s.teacher_id,
      label: label(3, periodName.get(s.period_id) ?? "Period"),
      before: cellJson(s),
      after: null,
      reason: "Cleared for the Term 2 re-plan: a new elective teacher joins in October.",
      created_at: "2026-09-20T09:30:00+05:30",
    })),
  ];
  const { error } = await ctx.admin.from("timetable_changes").upsert(rows as never, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw new Error(`timetable-control: change log insert failed: ${error.message}`);

  // ---- covers logged before 0141's trigger existed ----
  await ctx.sql`
    insert into public.timetable_changes (
      institution_id, version_id, kind, action, class_section_id, weekday, period_id, on_date, substitution_id,
      teacher_id, prev_teacher_id, label, before, after, reason, actor_id, actor_name, created_at)
    select sub.institution_id, ts.version_id, 'substitution', 'cover', ts.class_section_id, ts.weekday, ts.period_id, sub.date, sub.id,
      sub.substitute_teacher_id, sub.original_teacher_id,
      coalesce(g.code, '?') || '-' || cs.name || ' · ' || (array['Mon','Tue','Wed','Thu','Fri','Sat'])[ts.weekday] || ' · ' || p.name,
      jsonb_build_object('teacherId', sub.original_teacher_id, 'teacher', o.full_name, 'subjectId', ts.subject_id, 'subject', s.name),
      jsonb_build_object('teacherId', sub.substitute_teacher_id, 'teacher', r.full_name, 'subjectId', ts.subject_id, 'subject', s.name),
      coalesce(nullif(btrim(sub.note), ''), case when sub.leave_request_id is not null then o.full_name || ' is on leave' end, 'Cover assigned'),
      sub.created_by, ${actorName}, sub.created_at
    from public.substitutions sub
    join public.timetable_slots ts on ts.id = sub.slot_id
    join public.class_sections cs on cs.id = ts.class_section_id
    left join public.grades g on g.id = cs.grade_id
    join public.periods p on p.id = ts.period_id
    join public.staff o on o.id = sub.original_teacher_id
    join public.staff r on r.id = sub.substitute_teacher_id
    left join public.subjects s on s.id = ts.subject_id
    where sub.institution_id = ${inst} and sub.status = 'assigned'
      and not exists (select 1 from public.timetable_changes c where c.substitution_id = sub.id)`;

  console.log(`  timetable-control: rules, April (archived) + Term 2 (draft) versions, ${rows.length} logged changes`);
}
