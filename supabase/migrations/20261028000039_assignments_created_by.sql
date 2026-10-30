-- T-042 fix round 1 (review LOW): 0026's teacher branches bound `created_by`
-- only to the institution, so a teacher could create an assignment
-- attributed to another staff member (e.g. the principal), or re-attribute
-- one in scope.
--   INSERT: the teacher branches require created_by = the caller's own staff
--           id in that institution (owner/principal unchanged);
--   UPDATE: `created_by` never changes for a non-trusted writer (trigger
--           below — a policy cannot see the old row; a self-referencing
--           subquery hits 42P17). Co-teachers still edit each other's drafts,
--           as teacher-scope.ts allows. UPDATE policy is 0026's, unchanged.
-- Every FK binding is exactly 0026's.

drop policy assignments_insert on public.assignments;
create policy assignments_insert on public.assignments
  for insert to authenticated
  with check (
    (
      institution_id = any((select app.my_institution_ids(array['owner', 'principal'])))
      or (
        (
          class_section_id = any((select app.my_class_teacher_section_ids()))
          or (class_section_id, subject_id) in (select t.class_section_id, t.subject_id from app.my_taught_section_subjects() t)
        )
        and created_by in (
          select m.staff_id from public.memberships m
          where m.user_id = (select app.current_user_id())
            and m.status = 'active'
            and m.institution_id = assignments.institution_id
        )
      )
    )
    and exists (
      select 1 from public.class_sections cs
      where cs.id = assignments.class_section_id and cs.institution_id = assignments.institution_id
    )
    and exists (
      select 1 from public.subjects s
      where s.id = assignments.subject_id and s.institution_id = assignments.institution_id
    )
    and (
      assignments.curriculum_unit_id is null
      or exists (
        select 1 from public.curriculum_units cu
        where cu.id = assignments.curriculum_unit_id and cu.institution_id = assignments.institution_id
      )
    )
    and app.staff_in_institution(assignments.created_by, assignments.institution_id)
  );

create function app.guard_assignment_created_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
  then
    return new;
  end if;

  if new.created_by is distinct from old.created_by then
    raise exception 'code:forbidden' using detail = 'assignments.created_by never changes';
  end if;

  return new;
end;
$$;

revoke execute on function app.guard_assignment_created_by() from public;

create trigger guard_assignment_created_by
before update on public.assignments
for each row execute function app.guard_assignment_created_by();
