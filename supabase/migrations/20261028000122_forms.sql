-- Features-18 #13: forms module (SPEC §A row 13). Consent / information
-- forms sent to class sections. Same shape as surveys (0099): audience rows,
-- one response per respondent, respondents read through a definer
-- (`my_open_forms`) and write only through a definer
-- (`submit_form_response`). Not anonymous, so a single response table with
-- a unique key replaces surveys' respondents/responses split.
--
-- Tables
--   forms          — title, description, fields jsonb, status draft -> published -> closed
--   form_sections  — audience rows (form_id, class_section_id); draft-only writes
--   form_responses — immutable (app.block_mutation); unique nulls not distinct
--                    (form_id, respondent_user_id, student_id); student_id is
--                    the child (guardian), the student themself, or null (teacher)
--
-- Functions
--   app.guard_forms_write()                      trigger: fields shape + status machine
--   app.form_targets(p_institution_id uuid)      internal: (form_id, student_id) the caller may answer
--   public.my_open_forms(p_institution_id uuid)  -> app.my_open_forms
--   public.submit_form_response(p_form_id uuid, p_student_id uuid, p_answers jsonb) -> app.submit_form_response
--
-- fields jsonb: array of 1-30 objects {type, label, required?, options?};
-- type in text/choice/consent; label 1-200 chars; required boolean;
-- options only for choice (2-10 distinct strings, 1-80 chars).
-- answers jsonb: array aligned one-for-one with fields; null allowed only
-- for a non-required field; text = string <= 500; choice = option index;
-- consent = boolean, and true when the field is required.
--
-- RLS matrix (form.manage = owner/principal/admin; form.respond =
-- guardian/student/teacher):
--   table          | owner/principal/admin          | guardian/student/teacher         | other staff
--   forms          | S I(draft) U D(draft)          | none (my_open_forms, published)  | none
--   form_sections  | S I(draft form) D(draft form)  | none                             | none
--   form_responses | S                              | S own rows; write via definer    | none
-- No INSERT/UPDATE/DELETE policy on form_responses: only
-- app.submit_form_response (SECURITY DEFINER) inserts; block_mutation
-- forbids update/delete (demo reset bypasses via app.allow_reset).

insert into app.module_catalog (key, default_enabled) values ('forms', true)
on conflict (key) do update set default_enabled = excluded.default_enabled;

-- ---------------------------------------------------------------------------
-- forms
-- ---------------------------------------------------------------------------

create table public.forms (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  title text not null check (length(title) between 1 and 120),
  description text check (description is null or length(description) <= 1000),
  fields jsonb not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  published_at timestamptz,
  published_by uuid references public.profiles (id),
  closed_at timestamptz,
  created_by uuid not null references public.profiles (id) default app.current_user_id(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Composite-FK target for form_sections / form_responses.
  constraint forms_id_institution_key unique (id, institution_id)
);

create index forms_institution_status_idx on public.forms (institution_id, status);

create trigger set_updated_at
before update on public.forms
for each row execute function app.set_updated_at();

-- Validates `fields` on insert and on any draft edit that changes it (a
-- CHECK cannot report code:validation_failed for a jsonb shape; same
-- approach as 0099's guard_surveys_write). Status machine: draft edits are
-- free; draft -> published needs >= 1 audience section and stamps
-- published_*; published -> closed stamps closed_at; content is frozen
-- once published so stored answers stay aligned with fields.
create function app.guard_forms_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_field jsonb;
  v_type text;
  v_options jsonb;
begin
  if tg_op = 'UPDATE' then
    if new.institution_id is distinct from old.institution_id
      or new.created_by is distinct from old.created_by
    then
      raise exception 'code:invalid_state' using detail = 'institution_id and created_by are immutable';
    end if;

    if old.status = 'draft' and new.status = 'draft' then
      new.published_at := null;
      new.published_by := null;
      new.closed_at := null;
      if new.fields is not distinct from old.fields then
        return new;
      end if;
      -- fall through to fields validation below
    else
      if new.title is distinct from old.title
        or new.description is distinct from old.description
        or new.fields is distinct from old.fields
      then
        raise exception 'code:invalid_state' using detail = 'a form can only be edited while it is a draft';
      end if;

      if old.status = 'draft' and new.status = 'published' then
        if not exists (select 1 from public.form_sections fs where fs.form_id = new.id) then
          raise exception 'code:invalid_state' using detail = 'form needs at least one audience section before it can be published';
        end if;
        new.published_at := now();
        new.published_by := app.current_user_id();
        new.closed_at := null;
        return new;
      end if;

      if old.status = 'published' and new.status = 'closed' then
        new.published_at := old.published_at;
        new.published_by := old.published_by;
        new.closed_at := now();
        return new;
      end if;

      raise exception 'code:invalid_state' using detail = 'forms may only move from draft to published, or published to closed';
    end if;
  end if;

  if jsonb_typeof(new.fields) is distinct from 'array' then
    raise exception 'code:validation_failed' using detail = 'fields must be an array';
  end if;
  if jsonb_array_length(new.fields) < 1 or jsonb_array_length(new.fields) > 30 then
    raise exception 'code:validation_failed' using detail = 'fields must have between 1 and 30 entries';
  end if;

  for v_field in select elem from jsonb_array_elements(new.fields) as elem loop
    if jsonb_typeof(v_field) is distinct from 'object' then
      raise exception 'code:validation_failed' using detail = 'each field must be an object';
    end if;
    if exists (
      select 1 from jsonb_object_keys(v_field) k
      where k not in ('type', 'label', 'required', 'options')
    ) then
      raise exception 'code:validation_failed' using detail = 'a field may only have type, label, required, options';
    end if;

    v_type := v_field ->> 'type';
    if v_type is null or v_type not in ('text', 'choice', 'consent') then
      raise exception 'code:validation_failed' using detail = 'field type must be text, choice, or consent';
    end if;

    if jsonb_typeof(v_field -> 'label') is distinct from 'string' then
      raise exception 'code:validation_failed' using detail = 'field label must be a string';
    end if;
    if length(v_field ->> 'label') < 1 or length(v_field ->> 'label') > 200 then
      raise exception 'code:validation_failed' using detail = 'field label must be 1-200 characters';
    end if;

    if v_field ? 'required' and jsonb_typeof(v_field -> 'required') is distinct from 'boolean' then
      raise exception 'code:validation_failed' using detail = 'field required must be a boolean';
    end if;

    v_options := v_field -> 'options';
    if v_type = 'choice' then
      if jsonb_typeof(v_options) is distinct from 'array' then
        raise exception 'code:validation_failed' using detail = 'choice fields must have an options array';
      end if;
      if jsonb_array_length(v_options) < 2 or jsonb_array_length(v_options) > 10 then
        raise exception 'code:validation_failed' using detail = 'options must have between 2 and 10 entries';
      end if;
      if exists (
        select 1 from jsonb_array_elements(v_options) opt
        where jsonb_typeof(opt) is distinct from 'string'
      ) then
        raise exception 'code:validation_failed' using detail = 'each option must be a string';
      end if;
      if exists (
        select 1 from jsonb_array_elements_text(v_options) opt
        where length(opt) < 1 or length(opt) > 80
      ) then
        raise exception 'code:validation_failed' using detail = 'each option must be 1-80 characters';
      end if;
      if (select count(distinct opt) from jsonb_array_elements(v_options) opt) <> jsonb_array_length(v_options) then
        raise exception 'code:validation_failed' using detail = 'options must be distinct';
      end if;
    elsif v_options is not null then
      raise exception 'code:validation_failed' using detail = 'only choice fields have options';
    end if;
  end loop;

  return new;
end;
$$;

revoke execute on function app.guard_forms_write() from public;

create trigger guard_forms_write
before insert or update on public.forms
for each row execute function app.guard_forms_write();

alter table public.forms enable row level security;

create policy forms_select on public.forms
  for select to authenticated
  using (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

create policy forms_insert on public.forms
  for insert to authenticated
  with check (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    and created_by = (select app.current_user_id())
    and status = 'draft'
    and published_at is null
    and published_by is null
    and closed_at is null
  );

create policy forms_update on public.forms
  for update to authenticated
  using (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))))
  with check (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

create policy forms_delete on public.forms
  for delete to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    and status = 'draft'
  );

revoke all on public.forms from anon, authenticated;
grant select, insert, update, delete on public.forms to authenticated;

-- ---------------------------------------------------------------------------
-- form_sections — audience rows (ptm_event_sections shape, 0099). Writes
-- only while the form is a draft; no update (delete + insert).
-- ---------------------------------------------------------------------------

create table public.form_sections (
  form_id uuid not null,
  institution_id uuid not null references public.institutions (id),
  class_section_id uuid not null references public.class_sections (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (form_id, class_section_id),
  constraint form_sections_form_fk foreign key (form_id, institution_id)
    references public.forms (id, institution_id) on delete cascade
);

create index form_sections_section_idx on public.form_sections (class_section_id);
create index form_sections_institution_idx on public.form_sections (institution_id);

create trigger set_updated_at
before update on public.form_sections
for each row execute function app.set_updated_at();

alter table public.form_sections enable row level security;

create policy form_sections_select on public.form_sections
  for select to authenticated
  using (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

create policy form_sections_insert on public.form_sections
  for insert to authenticated
  with check (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    and exists (
      select 1 from public.forms f
      where f.id = form_sections.form_id
        and f.institution_id = form_sections.institution_id
        and f.status = 'draft'
    )
    and exists (
      select 1 from public.class_sections cs
      where cs.id = form_sections.class_section_id
        and cs.institution_id = form_sections.institution_id
    )
  );

create policy form_sections_delete on public.form_sections
  for delete to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    and exists (
      select 1 from public.forms f
      where f.id = form_sections.form_id
        and f.institution_id = form_sections.institution_id
        and f.status = 'draft'
    )
  );

revoke all on public.form_sections from anon, authenticated;
grant select, insert, delete on public.form_sections to authenticated;

-- ---------------------------------------------------------------------------
-- form_responses — immutable. No write policy: only
-- app.submit_form_response (SECURITY DEFINER) inserts.
-- ---------------------------------------------------------------------------

create table public.form_responses (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  form_id uuid not null,
  respondent_user_id uuid not null references public.profiles (id),
  student_id uuid references public.students (id),
  answers jsonb not null check (jsonb_typeof(answers) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint form_responses_form_fk foreign key (form_id, institution_id)
    references public.forms (id, institution_id),
  constraint form_responses_one_per_respondent_key
    unique nulls not distinct (form_id, respondent_user_id, student_id)
);

create index form_responses_respondent_idx on public.form_responses (respondent_user_id);
create index form_responses_institution_form_idx on public.form_responses (institution_id, form_id);

create trigger set_updated_at
before update on public.form_responses
for each row execute function app.set_updated_at();

create trigger block_mutation
before update or delete on public.form_responses
for each row execute function app.block_mutation();

alter table public.form_responses enable row level security;

create policy form_responses_select on public.form_responses
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or respondent_user_id = (select app.current_user_id())
  );

revoke all on public.form_responses from anon, authenticated;
grant select on public.form_responses to authenticated;

-- ---------------------------------------------------------------------------
-- app.form_targets — internal only (no authenticated grant; called from the
-- definers below). Every (form_id, student_id) pair the caller may answer
-- in p_institution_id, whatever the form's status:
--   guardian — each linked child with an active enrolment in an audience section
--   student  — themself, when actively enrolled in an audience section
--   teacher  — (form, null) when they teach an audience section
-- Each branch joins the caller's own active membership of that role in
-- p_institution_id, and every leg is institution-joined (lesson 2).
-- ---------------------------------------------------------------------------

create function app.form_targets(p_institution_id uuid)
returns table (form_id uuid, student_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select fs.form_id, e.student_id
  from public.memberships m
  join public.guardian_students gs
    on gs.guardian_id = m.guardian_id
   and gs.institution_id = m.institution_id
  join public.enrolments e
    on e.student_id = gs.student_id
   and e.institution_id = m.institution_id
   and e.status = 'active'
  join public.form_sections fs
    on fs.class_section_id = e.class_section_id
   and fs.institution_id = m.institution_id
  where m.user_id = app.current_user_id()
    and m.institution_id = p_institution_id
    and m.status = 'active'
    and m.role = 'guardian'
    and m.guardian_id is not null
  union
  select fs.form_id, e.student_id
  from public.memberships m
  join public.enrolments e
    on e.student_id = m.student_id
   and e.institution_id = m.institution_id
   and e.status = 'active'
  join public.form_sections fs
    on fs.class_section_id = e.class_section_id
   and fs.institution_id = m.institution_id
  where m.user_id = app.current_user_id()
    and m.institution_id = p_institution_id
    and m.status = 'active'
    and m.role = 'student'
    and m.student_id is not null
  union
  select fs.form_id, null::uuid
  from public.memberships m
  join public.form_sections fs
    on fs.institution_id = m.institution_id
  where m.user_id = app.current_user_id()
    and m.institution_id = p_institution_id
    and m.status = 'active'
    and m.role = 'teacher'
    and fs.class_section_id = any(array(select app.my_taught_section_ids()));
$$;

revoke all on function app.form_targets(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- app.my_open_forms / public.my_open_forms — published forms the caller may
-- answer, one row per (form, student) target, with a `responded` flag.
-- ---------------------------------------------------------------------------

create function app.my_open_forms(p_institution_id uuid)
returns table (
  id uuid,
  title text,
  description text,
  fields jsonb,
  published_at timestamptz,
  student_id uuid,
  student_name text,
  responded boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := app.current_user_id();
begin
  if v_user_id is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  return query
    select
      f.id,
      f.title,
      f.description,
      f.fields,
      f.published_at,
      t.student_id,
      btrim(st.first_name || ' ' || coalesce(st.last_name, '')),
      exists (
        select 1 from public.form_responses r
        where r.form_id = f.id
          and r.respondent_user_id = v_user_id
          and r.student_id is not distinct from t.student_id
      )
    from app.form_targets(p_institution_id) t
    join public.forms f
      on f.id = t.form_id
     and f.institution_id = p_institution_id
    left join public.students st
      on st.id = t.student_id
     and st.institution_id = p_institution_id
    where f.status = 'published'
    order by f.published_at desc, st.first_name nulls first, st.last_name;
end;
$$;

revoke all on function app.my_open_forms(uuid) from public, anon, authenticated;

create function public.my_open_forms(p_institution_id uuid)
returns table (
  id uuid,
  title text,
  description text,
  fields jsonb,
  published_at timestamptz,
  student_id uuid,
  student_name text,
  responded boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query select * from app.my_open_forms(p_institution_id);
end;
$$;

revoke execute on function public.my_open_forms(uuid) from public, anon;
grant execute on function public.my_open_forms(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- app.submit_form_response / public.submit_form_response — returns the new
-- response id. Not a target (incl. "form does not exist" and draft forms)
-- -> not_found, so existence is never leaked. p_student_id must match a
-- target exactly: the guardian's own child, the student themself, or null
-- for a teacher.
-- ---------------------------------------------------------------------------

create function app.submit_form_response(p_form_id uuid, p_student_id uuid, p_answers jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := app.current_user_id();
  v_form public.forms;
  v_idx int;
  v_field jsonb;
  v_answer jsonb;
  v_type text;
  v_required boolean;
  v_text text;
  v_response_id uuid;
begin
  if v_user_id is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  -- `for share`: a concurrent close waits for this response to commit.
  select * into v_form from public.forms where id = p_form_id for share;

  if v_form.id is null
    or v_form.status = 'draft'
    or not exists (
      select 1 from app.form_targets(v_form.institution_id) t
      where t.form_id = p_form_id
        and t.student_id is not distinct from p_student_id
    )
  then
    raise exception 'code:not_found' using detail = 'form not found';
  end if;

  if v_form.status <> 'published' then
    raise exception 'code:invalid_state' using detail = 'form is closed';
  end if;

  if jsonb_typeof(p_answers) is distinct from 'array' then
    raise exception 'code:validation_failed' using detail = 'answers must be an array';
  end if;
  if jsonb_array_length(p_answers) <> jsonb_array_length(v_form.fields) then
    raise exception 'code:validation_failed' using detail = 'answers must align one-for-one with the form fields';
  end if;

  for v_idx in 0 .. jsonb_array_length(v_form.fields) - 1 loop
    v_field := v_form.fields -> v_idx;
    v_answer := p_answers -> v_idx;
    v_type := v_field ->> 'type';
    v_required := coalesce((v_field ->> 'required')::boolean, false);

    if jsonb_typeof(v_answer) = 'null' then
      if v_required then
        raise exception 'code:validation_failed' using detail = format('field %s is required', v_idx);
      end if;
      continue;
    end if;

    if v_type = 'text' then
      if jsonb_typeof(v_answer) is distinct from 'string' then
        raise exception 'code:validation_failed' using detail = format('field %s expects text', v_idx);
      end if;
      v_text := v_answer #>> '{}';
      if length(v_text) > 500 then
        raise exception 'code:validation_failed' using detail = format('field %s allows at most 500 characters', v_idx);
      end if;
      if v_required and length(btrim(v_text)) = 0 then
        raise exception 'code:validation_failed' using detail = format('field %s is required', v_idx);
      end if;
    elsif v_type = 'choice' then
      if jsonb_typeof(v_answer) is distinct from 'number' or (v_answer #>> '{}') !~ '^[0-9]{1,2}$' then
        raise exception 'code:validation_failed' using detail = format('field %s expects a valid option index', v_idx);
      end if;
      if (v_answer #>> '{}')::int >= jsonb_array_length(v_field -> 'options') then
        raise exception 'code:validation_failed' using detail = format('field %s expects a valid option index', v_idx);
      end if;
    else -- consent
      if jsonb_typeof(v_answer) is distinct from 'boolean' then
        raise exception 'code:validation_failed' using detail = format('field %s expects true or false', v_idx);
      end if;
      if v_required and v_answer <> 'true'::jsonb then
        raise exception 'code:validation_failed' using detail = format('consent for field %s is required', v_idx);
      end if;
    end if;
  end loop;

  begin
    insert into public.form_responses (institution_id, form_id, respondent_user_id, student_id, answers)
    values (v_form.institution_id, p_form_id, v_user_id, p_student_id, p_answers)
    returning id into v_response_id;
  exception
    when unique_violation then
      raise exception 'code:conflict' using detail = 'You have already responded.';
  end;

  perform app.audit(
    v_form.institution_id,
    v_user_id,
    'form.response.submitted',
    'form_responses',
    v_response_id,
    null,
    jsonb_build_object('formId', p_form_id, 'studentId', p_student_id),
    null
  );

  return v_response_id;
end;
$$;

revoke all on function app.submit_form_response(uuid, uuid, jsonb) from public, anon, authenticated;

create function public.submit_form_response(p_form_id uuid, p_student_id uuid, p_answers jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.submit_form_response(p_form_id, p_student_id, p_answers);
end;
$$;

revoke execute on function public.submit_form_response(uuid, uuid, jsonb) from public, anon;
grant execute on function public.submit_form_response(uuid, uuid, jsonb) to authenticated;
