// 0155: demo teachers arrive with a filled-in teaching profile, so Teacher qualifications has data:
// qualifications follow the post (PRT: D.El.Ed. + B.A.; TGT: a bachelor's in their most-taught subject + B.Ed.;
// PGT: a master's in their most-taught subject + B.Ed.), subjects and classes come from their real
// subject_assignments. The demo login teacher.vi-a is left unfilled, so the demo shows the first
// sign-in reminder and form. Idempotent: every run rewrites the same values.
import type { SeedContext } from "../lib/context.ts";

// Subjects whose degree is a B.Sc./M.Sc.; every other subject gets a B.A./M.A.
const SCIENCE = ["Mathematics", "Science", "Physics", "Chemistry", "Biology", "Computer Science", "Environmental Studies"];

export async function run(ctx: SeedContext): Promise<void> {
  const skip = ctx.linkIdByLogin["teacher.vi-a"] ?? "00000000-0000-0000-0000-000000000000";
  await ctx.sql`
    with taught as (
      select sa.teacher_id,
             array_agg(distinct sa.subject_id) as subject_ids,
             array_agg(distinct cs.grade_id) as grade_ids,
             mode() within group (order by sub.name) as main_subject
      from public.subject_assignments sa
      join public.class_sections cs on cs.id = sa.class_section_id
      join public.subjects sub on sub.id = sa.subject_id
      where sa.institution_id = ${ctx.institutionId}
      group by sa.teacher_id
    )
    update public.staff s
    set qualifications = case s.designation
          when 'PRT' then jsonb_build_array(
            jsonb_build_object('level', 'diploma', 'degree', 'D.El.Ed.'),
            jsonb_build_object('level', 'bachelors', 'degree', 'B.A.'))
          when 'PGT' then jsonb_build_array(
            jsonb_build_object('level', 'masters', 'degree', case when t.main_subject in (select unnest(${SCIENCE}::text[])) then 'M.Sc.' else 'M.A.' end, 'subject', t.main_subject),
            jsonb_build_object('level', 'bachelors', 'degree', 'B.Ed.'))
          else jsonb_build_array(
            jsonb_build_object('level', 'bachelors', 'degree', case when t.main_subject in (select unnest(${SCIENCE}::text[])) then 'B.Sc.' else 'B.A.' end, 'subject', t.main_subject),
            jsonb_build_object('level', 'bachelors', 'degree', 'B.Ed.'))
        end,
        highest_qualification = case s.designation when 'PRT' then 'bachelors' when 'PGT' then 'masters' else 'bachelors' end,
        can_teach_subject_ids = coalesce(t.subject_ids, '{}'),
        can_teach_grade_ids = coalesce(t.grade_ids, '{}'),
        experience_years = 2 + abs(hashtext(s.id::text)) % 18,
        onboarded_at = coalesce(s.onboarded_at, now())
    from taught t
    where s.id = t.teacher_id
      and s.institution_id = ${ctx.institutionId}
      and s.is_teaching
      and s.id <> ${skip}
  `;
}
