-- M04-T2: CSV import — `import_batches` / `import_rows` tables + RLS.
-- `commit_import_batch` (M04-T3) is appended to this same file once applied
-- locally (it is unpushed, same pattern 0066's header note anticipates).
--
-- Scope: students (+guardian+link+enrolment) and staff only (DBT-44 defers
-- fee-structure/marks CSV import). RLS mirrors `invitations` (0064): narrower
-- than the usual `app.staff_roles()` read — only owner/principal/admin,
-- matching the new `data.import` permission (M04-T1) exactly, so a caller
-- who could reach `import_rows` directly over PostgREST gains nothing the
-- security-invoker `commit_import_batch` wouldn't already let them do.
-- `import_rows` INSERT/UPDATE additionally binds `batch_id` to a batch of
-- the same institution (0036/0065 lesson 2 pattern) so an admin of
-- institution A can never attach a row to institution B's batch even
-- though both share the "owner/principal/admin" role check.

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  entity_type text not null check (entity_type in ('students', 'staff')),
  status text not null default 'staged' check (status in ('staged', 'committed')),
  file_name text not null check (length(file_name) <= 200),
  row_count int not null default 0,
  valid_count int not null default 0,
  error_count int not null default 0,
  committed_count int not null default 0,
  skipped_count int not null default 0,
  created_by uuid references public.profiles (id),
  committed_by uuid references public.profiles (id),
  committed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index import_batches_institution_id_idx on public.import_batches (institution_id);

create trigger set_updated_at
before update on public.import_batches
for each row execute function app.set_updated_at();

create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches (id),
  institution_id uuid not null references public.institutions (id),
  row_no int not null,
  data jsonb not null,
  errors jsonb,
  status text check (status in ('valid', 'invalid', 'committed', 'skipped')),
  entity_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, row_no)
);

create index import_rows_institution_id_idx on public.import_rows (institution_id);
create index import_rows_batch_id_idx on public.import_rows (batch_id);

create trigger set_updated_at
before update on public.import_rows
for each row execute function app.set_updated_at();

alter table public.import_batches enable row level security;
alter table public.import_rows enable row level security;

create policy import_batches_select on public.import_batches
  for select to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']));

create policy import_batches_insert on public.import_batches
  for insert to authenticated
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

create policy import_batches_update on public.import_batches
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

create policy import_rows_select on public.import_rows
  for select to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']));

create policy import_rows_insert on public.import_rows
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and exists (
      select 1 from public.import_batches b
      where b.id = import_rows.batch_id and b.institution_id = import_rows.institution_id
    )
  );

create policy import_rows_update on public.import_rows
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and exists (
      select 1 from public.import_batches b
      where b.id = import_rows.batch_id and b.institution_id = import_rows.institution_id
    )
  );

-- ---------------------------------------------------------------------------
-- M04-T3: commit_import_batch
-- ---------------------------------------------------------------------------
--
-- `commit_import_batch` itself is **security invoker** (ruling: every entity
-- write goes through the caller's own RLS, same as a direct PostgREST
-- insert) — but that means its own first `select ... for update` on
-- `import_batches` is RLS-filtered too (owner/principal/admin only, T2), so
-- it cannot tell "no such batch" from "exists, caller's role is too low"
-- (e.g. teacher) by itself: both read back no row. `app.lock_import_batch`
-- is a narrow SECURITY DEFINER peek (same shape as `app.staff_in_institution`,
-- 0016) that takes the row lock bypassing RLS so the caller-role check
-- below can raise a real `forbidden` instead of a misleading `not_found`
-- for a same-institution caller with an insufficient role — matching
-- `revoke_invitation`'s (0079) not_found-only-if-truly-missing shape.
--
-- `app.audit` has no EXECUTE grant to `authenticated` (0003) — deliberately,
-- so no authenticated caller can forge an arbitrary audit_events row.
-- `commit_import_batch` runs as `authenticated` (security invoker), so it
-- cannot call `app.audit` directly; `app.audit_import_commit` is a narrow
-- SECURITY DEFINER wrapper (same "validate, then delegate" shape as
-- `app.enqueue_job`, 0003) that re-checks the caller's role itself before
-- writing the counts-only audit row.

create function app.lock_import_batch(p_batch_id uuid)
returns public.import_batches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.import_batches;
begin
  select * into v_batch from public.import_batches where id = p_batch_id for update;
  -- Definer: re-check the caller's role so this never hands out another
  -- institution's batch (lesson 4), even though `app` is not REST-exposed.
  if v_batch.id is not null and not app.has_role(v_batch.institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:forbidden' using detail = 'caller cannot commit this batch';
  end if;
  return v_batch;
end;
$$;

revoke execute on function app.lock_import_batch(uuid) from public;
grant execute on function app.lock_import_batch(uuid) to authenticated;

create function app.audit_import_commit(
  p_institution_id uuid,
  p_batch_id uuid,
  p_committed int,
  p_skipped int,
  p_invalid int
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.has_role(p_institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:forbidden' using detail = 'caller is not permitted to audit this institution';
  end if;

  perform app.audit(
    p_institution_id, app.current_user_id(), 'imports.batch.committed', 'import_batches', p_batch_id,
    null, null, jsonb_build_object('committed', p_committed, 'skipped', p_skipped, 'invalid', p_invalid)
  );
end;
$$;

revoke execute on function app.audit_import_commit(uuid, uuid, int, int, int) from public;
grant execute on function app.audit_import_commit(uuid, uuid, int, int, int) to authenticated;

-- Discovered while building commit_import_batch (DB finding, pre-existing,
-- not introduced here): a bare, RLS-governed `insert into guardian_students`
-- throws "infinite recursion detected in policy for relation
-- guardian_students". Cause: `guardian_students_insert`'s `with check`
-- (0020 fix round 1) does `exists (select ... from students ...)`, which
-- runs `students_select` (0025/0035), which does
-- `id in (select app.my_student_ids())`. `app.my_student_ids` (0020) is a
-- `language sql` SECURITY DEFINER function whose body the planner can
-- inline; an inlined SQL function body runs under the ORIGINAL caller's
-- privileges, not the owner's, so its own `from public.guardian_students`
-- loses the SECURITY DEFINER RLS bypass and re-enters `guardian_students`'
-- policy while that same relation's policy is already being evaluated for
-- the outer INSERT — Postgres's self-recursion guard trips. This has never
-- fired before because every existing write to `guardian_students` goes
-- through a SECURITY DEFINER RPC (bypassing its RLS entirely, e.g. 0008's
-- enrol flow); `commit_import_batch` is the first caller to write it under
-- real invoker RLS. Out of scope to fix app.my_student_ids itself (merged
-- migration, rule 9); this narrow SECURITY DEFINER wrapper re-implements
-- exactly what `guardian_students_insert`'s `with check` already requires
-- (role + both FKs in-institution) and performs the insert as the owner,
-- bypassing RLS so the recursive path is never entered. Scoped to imports
-- only (role set matches `data.import`, not the policy's wider
-- admissions-inclusive set) — not a general-purpose replacement for the
-- policy.
create function app.import_insert_guardian_student(
  p_institution_id uuid,
  p_guardian_id uuid,
  p_student_id uuid,
  p_relationship text,
  p_is_primary boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.has_role(p_institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:forbidden' using detail = 'caller is not permitted to link a guardian to a student in this institution';
  end if;

  if not exists (select 1 from public.guardians g where g.id = p_guardian_id and g.institution_id = p_institution_id) then
    raise exception 'code:validation_failed' using detail = 'guardian does not belong to this institution';
  end if;

  if not exists (select 1 from public.students st where st.id = p_student_id and st.institution_id = p_institution_id) then
    raise exception 'code:validation_failed' using detail = 'student does not belong to this institution';
  end if;

  insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
  values (p_institution_id, p_guardian_id, p_student_id, p_relationship, p_is_primary);
end;
$$;

revoke execute on function app.import_insert_guardian_student(uuid, uuid, uuid, text, boolean) from public;
grant execute on function app.import_insert_guardian_student(uuid, uuid, uuid, text, boolean) to authenticated;

create function public.commit_import_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch public.import_batches;
  v_row record;
  v_entity_id uuid;
  v_guardian_id uuid;
  v_error text;
  v_committed int := 0;
  v_skipped int := 0;
  v_invalid int := 0;
begin
  v_batch := app.lock_import_batch(p_batch_id);
  if v_batch.id is null then
    raise exception 'code:not_found' using detail = 'import batch not found';
  end if;

  if not app.has_role(v_batch.institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:forbidden' using detail = 'only an owner, principal, or admin commits an import batch';
  end if;

  if v_batch.status = 'committed' then
    return jsonb_build_object(
      'committed', v_batch.committed_count,
      'skipped', v_batch.skipped_count,
      'invalid', v_batch.error_count
    );
  end if;

  -- Staging writes the batch (with row_count) before its row chunks; a
  -- failed chunk leaves fewer rows than row_count — never commit that.
  if v_batch.row_count <> (select count(*) from public.import_rows r where r.batch_id = v_batch.id) then
    raise exception 'code:invalid_state' using detail = 'import batch is incomplete; stage the file again';
  end if;

  for v_row in
    select * from public.import_rows
    where batch_id = p_batch_id and status = 'valid'
    order by row_no
  loop
    begin
      if v_batch.entity_type = 'students' then
        if exists (
          select 1 from public.students s
          where s.institution_id = v_batch.institution_id and s.admission_no = v_row.data ->> 'admission_no'
        ) then
          update public.import_rows set status = 'skipped' where id = v_row.id;
          v_skipped := v_skipped + 1;
        else
          insert into public.students (institution_id, admission_no, first_name, last_name, dob, gender)
          values (
            v_batch.institution_id,
            v_row.data ->> 'admission_no',
            v_row.data ->> 'first_name',
            v_row.data ->> 'last_name',
            (v_row.data ->> 'dob')::date,
            v_row.data ->> 'gender'
          )
          returning id into v_entity_id;

          select id into v_guardian_id from public.guardians
          where institution_id = v_batch.institution_id and phone = v_row.data ->> 'guardian_phone';

          if v_guardian_id is null then
            insert into public.guardians (institution_id, full_name, phone, email)
            values (
              v_batch.institution_id,
              v_row.data ->> 'guardian_name',
              v_row.data ->> 'guardian_phone',
              v_row.data ->> 'guardian_email'
            )
            returning id into v_guardian_id;
          end if;

          -- A freshly inserted student has no prior guardian_students rows,
          -- so this import's guardian is always its first (primary) link.
          -- Goes through app.import_insert_guardian_student, not a bare
          -- insert (see that function's comment above) — a direct
          -- `insert into public.guardian_students` here hits a pre-existing
          -- RLS recursion bug in guardian_students_insert's with check.
          perform app.import_insert_guardian_student(
            v_batch.institution_id, v_guardian_id, v_entity_id, v_row.data ->> 'guardian_relationship', true
          );

          insert into public.enrolments (institution_id, student_id, class_section_id, academic_year_id, roll_no, started_on)
          values (
            v_batch.institution_id,
            v_entity_id,
            (v_row.data ->> 'class_section_id')::uuid,
            (v_row.data ->> 'academic_year_id')::uuid,
            (v_row.data ->> 'roll_no')::int,
            current_date
          );

          update public.import_rows set status = 'committed', entity_id = v_entity_id where id = v_row.id;
          v_committed := v_committed + 1;
        end if;
      else
        if exists (
          select 1 from public.staff s
          where s.institution_id = v_batch.institution_id and s.employee_no = v_row.data ->> 'employee_no'
        ) then
          update public.import_rows set status = 'skipped' where id = v_row.id;
          v_skipped := v_skipped + 1;
        else
          insert into public.staff (institution_id, employee_no, full_name, designation, department_id, phone, email, is_teaching)
          values (
            v_batch.institution_id,
            v_row.data ->> 'employee_no',
            v_row.data ->> 'full_name',
            v_row.data ->> 'designation',
            (v_row.data ->> 'department_id')::uuid,
            v_row.data ->> 'phone',
            v_row.data ->> 'email',
            (v_row.data ->> 'is_teaching')::boolean
          )
          returning id into v_entity_id;

          update public.import_rows set status = 'committed', entity_id = v_entity_id where id = v_row.id;
          v_committed := v_committed + 1;
        end if;
      end if;
    exception
      when others then
        v_error := case sqlstate
          when '23505' then 'duplicate value'
          when '23503' then 'referenced record not found'
          when '23502' then 'missing required field'
          when '23514' then 'value failed a check constraint'
          when '22007' then 'invalid date'
          when '22P02' then 'invalid value'
          else 'row could not be committed'
        end;
        update public.import_rows set status = 'invalid', errors = jsonb_build_array(v_error) where id = v_row.id;
        v_invalid := v_invalid + 1;
    end;
  end loop;

  update public.import_batches
  set status = 'committed',
      committed_count = committed_count + v_committed,
      skipped_count = skipped_count + v_skipped,
      error_count = error_count + v_invalid,
      committed_by = app.current_user_id(),
      committed_at = now()
  where id = p_batch_id
  returning * into v_batch;

  perform app.audit_import_commit(v_batch.institution_id, p_batch_id, v_committed, v_skipped, v_invalid);

  return jsonb_build_object(
    'committed', v_batch.committed_count,
    'skipped', v_batch.skipped_count,
    'invalid', v_batch.error_count
  );
end;
$$;

revoke execute on function public.commit_import_batch(uuid) from public, anon;
grant execute on function public.commit_import_batch(uuid) to authenticated;
