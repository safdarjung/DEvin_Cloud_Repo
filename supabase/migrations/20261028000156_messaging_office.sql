-- 0156 messaging_office — the school office (owner/principal/admin) can message a
-- student's guardian. Same thread shape as 0102 (one guardian, one staff member,
-- one student); the office member's staff record is the staff side. Only the
-- role checks change: a teacher must still teach the child, a guardian still
-- writes only to the child's teachers, and the guardian must be linked to the
-- student. Read access is unchanged (0102 already lets these roles read every thread).

create or replace function app.message_side(p_thread public.message_threads)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.memberships m
    join public.guardian_students gs
      on gs.guardian_id = m.guardian_id and gs.institution_id = m.institution_id
    where m.user_id = app.current_user_id()
      and m.status = 'active'
      and m.institution_id = p_thread.institution_id
      and m.guardian_id = p_thread.guardian_id
      and gs.student_id = p_thread.student_id
  ) then
    return 'guardian';
  end if;

  if exists (
    select 1
    from public.memberships m
    where m.user_id = app.current_user_id()
      and m.status = 'active'
      and m.institution_id = p_thread.institution_id
      and m.staff_id = p_thread.teacher_staff_id
  ) and (
    app.staff_teaches_student(p_thread.institution_id, p_thread.teacher_staff_id, p_thread.student_id)
    -- The school office (owner/principal/admin) writes to any family; it is the staff side of threads it started.
    or app.has_role(p_thread.institution_id, array['owner', 'principal', 'admin'])
  ) then
    return 'teacher';
  end if;

  return null;
end;
$$;

revoke all on function app.message_side(public.message_threads) from public, anon, authenticated;

create or replace function public.start_message_thread(
  p_institution_id uuid,
  p_student_id uuid,
  p_counterpart_id uuid,
  p_subject text,
  p_body text
)
returns public.message_threads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_guardian_id uuid;
  v_staff_id uuid;
  v_thread public.message_threads;
  v_created boolean := false;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  if p_subject is null or length(btrim(p_subject)) not between 1 and 200
    or p_body is null or length(btrim(p_body)) not between 1 and 4000
  then
    raise exception 'code:validation_failed' using detail = 'subject 1-200 and body 1-4000 characters required';
  end if;

  if not app.is_member(p_institution_id) then
    raise exception 'code:not_found' using detail = 'institution not found';
  end if;

  if not app.module_enabled(p_institution_id, 'messaging') then
    raise exception 'code:forbidden' using detail = 'messaging is not enabled for this school';
  end if;

  if app.has_role(p_institution_id, array['guardian'])
    and p_student_id in (select app.guardian_student_ids(p_institution_id))
  then
    v_staff_id := p_counterpart_id;
    select m.guardian_id into v_guardian_id
    from public.memberships m
    join public.guardian_students gs
      on gs.guardian_id = m.guardian_id and gs.institution_id = m.institution_id
    where m.user_id = v_caller and m.institution_id = p_institution_id
      and m.status = 'active' and gs.student_id = p_student_id
    limit 1;
  elsif app.has_role(p_institution_id, array['teacher', 'owner', 'principal', 'admin']) then
    v_guardian_id := p_counterpart_id;
    v_staff_id := app.staff_id(p_institution_id);
    if v_staff_id is null or not exists (
      select 1 from public.guardian_students gs
      where gs.institution_id = p_institution_id
        and gs.guardian_id = p_counterpart_id
        and gs.student_id = p_student_id
    ) then
      raise exception 'code:forbidden' using detail = 'guardian is not linked to this student';
    end if;
  else
    raise exception 'code:forbidden' using detail = 'only guardians, teachers and the school office may start a message thread';
  end if;

  if v_guardian_id is null or v_staff_id is null
    or not exists (select 1 from public.staff s where s.id = v_staff_id and s.institution_id = p_institution_id)
    or (
      not app.staff_teaches_student(p_institution_id, v_staff_id, p_student_id)
      -- The office may write to any linked guardian; a guardian still writes only to the child's teachers.
      and not (v_staff_id = app.staff_id(p_institution_id) and app.has_role(p_institution_id, array['owner', 'principal', 'admin']))
    )
  then
    raise exception 'code:forbidden' using detail = 'teacher does not teach this student';
  end if;

  perform set_config('app.allow_message_write', 'on', true);

  insert into public.message_threads (institution_id, student_id, guardian_id, teacher_staff_id, subject, created_by)
  values (p_institution_id, p_student_id, v_guardian_id, v_staff_id, btrim(p_subject), v_caller)
  on conflict (institution_id, student_id, guardian_id, teacher_staff_id, subject) do nothing
  returning * into v_thread;

  if v_thread.id is not null then
    v_created := true;
  else
    select * into v_thread from public.message_threads
    where institution_id = p_institution_id and student_id = p_student_id
      and guardian_id = v_guardian_id and teacher_staff_id = v_staff_id and subject = btrim(p_subject);
  end if;

  perform app.post_message(v_thread, v_caller, btrim(p_body));

  if v_created then
    perform app.audit(
      p_institution_id,
      v_caller,
      'message_thread.started',
      'message_thread',
      v_thread.id,
      null,
      jsonb_build_object('student_id', p_student_id, 'guardian_id', v_guardian_id, 'teacher_staff_id', v_staff_id),
      null
    );
  end if;

  select * into v_thread from public.message_threads where id = v_thread.id;
  return v_thread;
end;
$$;

revoke execute on function public.start_message_thread(uuid, uuid, uuid, text, text) from public, anon;
grant execute on function public.start_message_thread(uuid, uuid, uuid, text, text) to authenticated;
