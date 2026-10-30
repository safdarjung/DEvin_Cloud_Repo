-- T-042 / DBT-32: `app.validate_membership_link` (0002) checked only the
-- role-vs-FK shape, never that the linked staff/guardian/student row belongs
-- to the membership's own institution. Every RLS helper (`app.staff_id`,
-- `app.my_student_ids`, `app.my_taught_section_ids`, ...) trusts that link,
-- so a membership in institution A pointing at B's student would be honoured
-- wherever a helper doesn't re-correlate the institution.
--
-- `create or replace` with the same signature and trigger. The function is
-- and stays SECURITY DEFINER (created in 0002, made definer in 0011): it must read
-- staff/guardians/students regardless of the writer's own RLS. Its existing
-- 07 §4 definer entry now records the extra check. Applies to every writer,
-- service_role and seed included: there is no legitimate cross-institution link.

create or replace function app.validate_membership_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = any(app.staff_roles()) then
    if new.staff_id is null or new.guardian_id is not null or new.student_id is not null then
      raise exception 'code:validation_failed' using detail = 'staff-class role requires staff_id and no guardian_id/student_id';
    end if;
    if not exists (select 1 from public.staff s where s.id = new.staff_id and s.institution_id = new.institution_id) then
      raise exception 'code:validation_failed' using detail = 'staff_id belongs to another institution';
    end if;
  elsif new.role = 'guardian' then
    if new.guardian_id is null or new.staff_id is not null or new.student_id is not null then
      raise exception 'code:validation_failed' using detail = 'guardian role requires guardian_id and no staff_id/student_id';
    end if;
    if not exists (select 1 from public.guardians g where g.id = new.guardian_id and g.institution_id = new.institution_id) then
      raise exception 'code:validation_failed' using detail = 'guardian_id belongs to another institution';
    end if;
  elsif new.role = 'student' then
    if new.student_id is null or new.staff_id is not null or new.guardian_id is not null then
      raise exception 'code:validation_failed' using detail = 'student role requires student_id and no staff_id/guardian_id';
    end if;
    if not exists (select 1 from public.students st where st.id = new.student_id and st.institution_id = new.institution_id) then
      raise exception 'code:validation_failed' using detail = 'student_id belongs to another institution';
    end if;
  end if;

  return new;
end;
$$;
