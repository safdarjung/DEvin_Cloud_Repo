# M20 progress notes

## M19 contract (written by T6, since no controller pass ran this check; M19 is merged — gate-M19.txt passed 2026-11-05)

Real names from `supabase/migrations/20261028000092_insights.sql` (read directly, not assumed):

- `public.insights`: columns match `Insight` shape — `signal`, `detector_version int`, `dedupe_key text` (unique with `institution_id`), `domain`, `kind`, `severity`, `title`, `pattern`, `evidence jsonb` (array, 1–8 items), `sources text[]`, `date_from`/`date_to`, `confidence numeric(3,2)`, `factors jsonb`, `reviewer_role`, `recommended_actions text[]`, `approval_required boolean`, `status` (`new|reviewing|actioned|resolved|dismissed`, default `new`), `entity_type`/`entity_id`/`entity_label` (**not** a single `entity_ref jsonb` — three separate columns; `entity_type in ('section','student','staff','route','fee_structure','department')`, `entity_label` forbidden when `entity_type` is `student`/`staff`), `class_section_id`, explanation/review/decision columns.
- Dedupe: `constraint insights_dedupe_key unique (institution_id, dedupe_key)` + `insights_open_key` partial unique on `(institution_id, signal, entity_type, entity_id)` where `status in ('new','reviewing','actioned')`. T12's gap detector dedupes on `dedupe_key` built from `(mastery_gap, student, window)`, matching this.
- `public.insight_actions` (pre-T6 columns): `id`, `institution_id`, `insight_id` (not null), `supersedes_id`, `action`, `owner`, `rationale`, `expected_outcome`, `actual_outcome`, `decided_at`, `measured_at`, `status` (`check in ('planned','done','measured')`, not null — **initial = `planned`, terminal = `done`**, matching the ruling's fallback exactly), `created_by uuid not null references public.profiles (id)`. No `kind` column before T6 (added by T6, part 3).
- No INSERT/UPDATE/DELETE RLS policy on `insights`/`insight_actions`/`briefings` pre-T6 (only `*_select`) — confirmed in the migration file. Only `record_insights` (service role) and the T3 definers (`decide_insight`, `record_insight_action`, `set_insight_explanation`) write them. **This means any authenticated INSERT into `insight_actions` is already RLS-denied with raw `42501`, with zero permissive INSERT policy before or after T6** — T6's own trigger must not pre-empt that with a custom raise, or the DB test expecting literal `42501` would instead see the trigger's `code:forbidden` (P0001).
- No guard trigger on `insight_actions` pre-T6 (only `set_updated_at`). T6 is free to add `app.guard_intervention`; no M19 object conflicts.
- `app.my_class_teacher_student_ids()` (X07, 0090): students with an active enrolment in a section the caller is class teacher of. Reused as-is by T6's intervention RLS.

## Status

T1–T5, T7, T8, T11, T13 done (reports in this dir). T6 in progress (this session).
