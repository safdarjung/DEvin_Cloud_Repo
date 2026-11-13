-- 0147 — Curriculum topics + textbook rights metadata
-- (15-learning-exam-system-plan.md, Phase 1).
--
-- curriculum_topics: curriculum_unit -> topic -> subtopic (parent_id). RLS
-- mirrors curriculum_units (0005/0065): staff read all; a student/guardian
-- reads the topics of a grade they (or their child) are actively enrolled
-- in; owner/principal/admin write. Unlike units, topics can be deleted (a
-- delete cascades to subtopics; questions keep their row, topic set null).
-- Depth (topic -> subtopic only, so no cycles) is checked in the action and
-- by app.curriculum_topics_depth_guard() for direct writes. No unique sequence: app.demo_reset nulls parent_id first, which would collide.
--
-- question_bank.curriculum_topic_id: the topic must sit under a unit of the
-- question's own grade and subject (checked in the 0073 insert/update
-- policies' spirit, here as a trigger because it is a two-table hop).
--
-- subject_textbooks gains edition, publication_year, isbn, board,
-- rights_status, permitted_use, source_note. NCERT rows stay link-only (0139
-- ruling): a trigger forces rights_status = 'link_only' whenever ncert_code
-- is set, and a check backs it; ncert_code is not client-updatable (the app
-- only inserts it), so a row cannot drop it to escape link_only. Custom
-- books default to 'unknown'.

create table public.curriculum_topics (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  curriculum_unit_id uuid not null references public.curriculum_units (id) on delete cascade,
  parent_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  sequence int not null check (sequence between 1 and 999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint curriculum_topics_id_institution_key unique (id, institution_id),
  constraint curriculum_topics_id_unit_key unique (id, curriculum_unit_id),
  -- A subtopic's parent is in the same unit. parent_id first: app.demo_reset nulls conkey[1].
  constraint curriculum_topics_parent_fkey foreign key (parent_id, curriculum_unit_id)
    references public.curriculum_topics (id, curriculum_unit_id) on delete cascade,
  constraint curriculum_topics_not_own_parent_check check (parent_id is null or parent_id <> id)
);

create index curriculum_topics_unit_idx on public.curriculum_topics (institution_id, curriculum_unit_id);

create trigger set_updated_at
before update on public.curriculum_topics
for each row execute function app.set_updated_at();

-- Same unit is the composite FK; here: the parent is a top-level topic and
-- this row has no subtopics of its own.
create function app.curriculum_topics_depth_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_id is not null and (
    exists (select 1 from public.curriculum_topics p where p.id = new.parent_id and p.parent_id is not null)
    or exists (select 1 from public.curriculum_topics c where c.parent_id = new.id)
  ) then
    raise exception 'code:validation_failed' using detail = 'Topics go two levels deep: topic and subtopic.';
  end if;
  return new;
end;
$$;

create trigger curriculum_topics_depth_guard
before insert or update of parent_id on public.curriculum_topics
for each row execute function app.curriculum_topics_depth_guard();

alter table public.curriculum_topics enable row level security;

create policy curriculum_topics_select on public.curriculum_topics
  for select to authenticated
  using (
    app.has_role(curriculum_topics.institution_id, app.staff_roles())
    or exists (
      select 1
      from public.curriculum_units cu
      join public.class_sections cs on cs.grade_id = cu.grade_id
      join public.enrolments e on e.class_section_id = cs.id
      where cu.id = curriculum_topics.curriculum_unit_id
        and e.status = 'active'
        and (
          e.student_id in (select app.guardian_student_ids(curriculum_topics.institution_id))
          or e.student_id = app.own_student_id(curriculum_topics.institution_id)
        )
    )
  );

create policy curriculum_topics_insert on public.curriculum_topics
  for insert to authenticated
  with check (
    app.has_role(curriculum_topics.institution_id, array['owner', 'principal', 'admin'])
    and exists (
      select 1 from public.curriculum_units cu
      where cu.id = curriculum_topics.curriculum_unit_id and cu.institution_id = curriculum_topics.institution_id
    )
  );

create policy curriculum_topics_update on public.curriculum_topics
  for update to authenticated
  using (app.has_role(curriculum_topics.institution_id, array['owner', 'principal', 'admin']))
  with check (app.has_role(curriculum_topics.institution_id, array['owner', 'principal', 'admin']));

create policy curriculum_topics_delete on public.curriculum_topics
  for delete to authenticated
  using (app.has_role(curriculum_topics.institution_id, array['owner', 'principal', 'admin']));

-- unit/institution never change (move = delete + create).
revoke all on public.curriculum_topics from anon, authenticated;
grant select, insert, delete on public.curriculum_topics to authenticated;
grant update (parent_id, title, sequence) on public.curriculum_topics to authenticated;
grant select, insert, update, delete on public.curriculum_topics to service_role;

-- ---------------------------------------------------------------------------
-- question_bank.curriculum_topic_id
-- ---------------------------------------------------------------------------

alter table public.question_bank
  add column curriculum_topic_id uuid,
  add constraint question_bank_topic_fkey foreign key (curriculum_topic_id, institution_id)
    references public.curriculum_topics (id, institution_id) on delete set null (curriculum_topic_id);

create index question_bank_topic_idx on public.question_bank (curriculum_topic_id) where curriculum_topic_id is not null;

create function app.question_bank_topic_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.curriculum_topic_id is not null and not exists (
    select 1
    from public.curriculum_topics t
    join public.curriculum_units cu on cu.id = t.curriculum_unit_id
    where t.id = new.curriculum_topic_id
      and t.institution_id = new.institution_id
      and cu.grade_id = new.grade_id
      and cu.subject_id = new.subject_id
      and (new.curriculum_unit_id is null or cu.id = new.curriculum_unit_id)
  ) then
    raise exception 'code:validation_failed' using detail = 'The topic is not in this grade, subject and unit.';
  end if;
  return new;
end;
$$;

create trigger question_bank_topic_guard
before insert or update of curriculum_topic_id, curriculum_unit_id, grade_id, subject_id on public.question_bank
for each row execute function app.question_bank_topic_guard();

grant update (curriculum_topic_id) on public.question_bank to authenticated;

-- ---------------------------------------------------------------------------
-- subject_textbooks metadata
-- ---------------------------------------------------------------------------

alter table public.subject_textbooks
  add column edition text check (edition is null or char_length(btrim(edition)) between 1 and 60),
  add column publication_year smallint check (publication_year is null or publication_year between 1950 and 2100),
  add column isbn text check (isbn is null or isbn ~ '^(97[89])?[0-9]{9}[0-9X]$'),
  add column board text check (board is null or char_length(btrim(board)) between 1 and 60),
  add column rights_status text not null default 'unknown'
    check (rights_status in ('link_only', 'school_owned', 'licensed', 'open_licence', 'unknown')),
  add column permitted_use text check (permitted_use is null or char_length(permitted_use) <= 500),
  add column source_note text check (source_note is null or char_length(source_note) <= 500);

update public.subject_textbooks set rights_status = 'link_only' where ncert_code is not null;

alter table public.subject_textbooks
  add constraint subject_textbooks_ncert_link_only_check check (ncert_code is null or rights_status = 'link_only');

create function app.subject_textbooks_rights_default()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.ncert_code is not null then
    new.rights_status := 'link_only';
  end if;
  return new;
end;
$$;

create trigger subject_textbooks_rights_default
before insert or update on public.subject_textbooks
for each row execute function app.subject_textbooks_rights_default();

grant update (edition, publication_year, isbn, board, rights_status, permitted_use, source_note) on public.subject_textbooks to authenticated;
revoke update (ncert_code) on public.subject_textbooks from authenticated;
