-- M03-T2: invite_member / accept_invitation / revoke_invitation — the three
-- RPCs that write `public.invitations` (0064 created the table function-only,
-- no INSERT/UPDATE/DELETE policy). Link validation mirrors
-- `app.validate_membership_link` (0029): staff-class roles need staff_id,
-- guardian needs guardian_id, student needs student_id, and the linked row
-- must belong to the same institution. Role-escalation gating mirrors
-- `app.guard_membership_write` (0033/0064): inviting/revoking an `owner`
-- needs an owner caller, a `principal` needs owner/principal.
--
-- Token: 32 random bytes (`extensions.gen_random_bytes`), hex-encoded and
-- returned to the caller once; only its sha256 hex (`extensions.digest`) is
-- stored, so a read of `invitations` (even by an admin — token_hash has no
-- SELECT grant, 0064) can never recover it. `accept_invitation` hashes the
-- caller-supplied token the same way and looks up by hash.
--
-- `accept_invitation` inserts the caller's own membership, so it needs the
-- same `app.allow_membership_bootstrap` bypass `create_institution` uses
-- (0064); reset immediately after that insert (not left for transaction end)
-- so nothing later in the same transaction could run under the bypass.

create function public.invite_member(
  p_institution_id uuid,
  p_email text,
  p_role text,
  p_staff_id uuid default null,
  p_guardian_id uuid default null,
  p_student_id uuid default null
)
returns table (invitation_id uuid, token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_email text;
  v_token text;
  v_token_hash text;
  v_invitation_id uuid;
begin
  v_uid := app.current_user_id();
  if not app.has_role(p_institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:forbidden' using detail = 'only an owner, principal, or admin invites members';
  end if;

  if p_role not in (
    'owner', 'principal', 'admin', 'admissions', 'accountant',
    'exam_controller', 'teacher', 'student', 'guardian'
  ) then
    raise exception 'code:validation_failed' using detail = 'unknown role';
  end if;

  if p_role = 'owner' and not app.has_role(p_institution_id, array['owner']) then
    raise exception 'code:forbidden' using detail = 'only an owner invites an owner';
  end if;

  if p_role = 'principal' and not app.has_role(p_institution_id, array['owner', 'principal']) then
    raise exception 'code:forbidden' using detail = 'only an owner or principal invites a principal';
  end if;

  v_email := lower(trim(p_email));
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'code:validation_failed' using detail = 'invalid email address';
  end if;

  if p_role = any(app.staff_roles()) then
    if p_staff_id is null or p_guardian_id is not null or p_student_id is not null then
      raise exception 'code:validation_failed' using detail = 'staff-class role requires staff_id and no guardian_id/student_id';
    end if;
    if not exists (select 1 from public.staff s where s.id = p_staff_id and s.institution_id = p_institution_id) then
      raise exception 'code:validation_failed' using detail = 'staff_id belongs to another institution';
    end if;
    if exists (
      select 1 from public.memberships m
      where m.staff_id = p_staff_id and m.role = p_role and m.status = 'active'
    ) then
      raise exception 'code:conflict' using detail = 'already an active member with this role';
    end if;
  elsif p_role = 'guardian' then
    if p_guardian_id is null or p_staff_id is not null or p_student_id is not null then
      raise exception 'code:validation_failed' using detail = 'guardian role requires guardian_id and no staff_id/student_id';
    end if;
    if not exists (select 1 from public.guardians g where g.id = p_guardian_id and g.institution_id = p_institution_id) then
      raise exception 'code:validation_failed' using detail = 'guardian_id belongs to another institution';
    end if;
    if exists (
      select 1 from public.memberships m
      where m.guardian_id = p_guardian_id and m.role = 'guardian' and m.status = 'active'
    ) then
      raise exception 'code:conflict' using detail = 'already an active member with this role';
    end if;
  elsif p_role = 'student' then
    if p_student_id is null or p_staff_id is not null or p_guardian_id is not null then
      raise exception 'code:validation_failed' using detail = 'student role requires student_id and no staff_id/guardian_id';
    end if;
    if not exists (select 1 from public.students st where st.id = p_student_id and st.institution_id = p_institution_id) then
      raise exception 'code:validation_failed' using detail = 'student_id belongs to another institution';
    end if;
    if exists (
      select 1 from public.memberships m
      where m.student_id = p_student_id and m.role = 'student' and m.status = 'active'
    ) then
      raise exception 'code:conflict' using detail = 'already an active member with this role';
    end if;
  end if;

  if exists (
    select 1 from public.invitations i
    where i.institution_id = p_institution_id
      and i.email = v_email
      and i.role = p_role
      and i.accepted_at is null
      and i.revoked_at is null
      and i.expires_at > now()
  ) then
    raise exception 'code:conflict' using detail = 'an open invitation already exists for this email and role';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  insert into public.invitations (
    institution_id, email, role, staff_id, guardian_id, student_id,
    token_hash, invited_by, expires_at
  )
  values (
    p_institution_id, v_email, p_role, p_staff_id, p_guardian_id, p_student_id,
    v_token_hash, v_uid, now() + interval '7 days'
  )
  returning id into v_invitation_id;

  perform app.audit(
    p_institution_id, v_uid, 'core.invitation.created', 'invitations', v_invitation_id,
    null, null, jsonb_build_object('role', p_role)
  );

  return query select v_invitation_id, v_token;
end;
$$;

revoke execute on function public.invite_member(uuid, text, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.invite_member(uuid, text, text, uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- accept_invitation
-- ---------------------------------------------------------------------------

create function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_caller_email text;
  v_token_hash text;
  v_invitation public.invitations;
  v_membership_id uuid;
  v_linked_user_id uuid;
begin
  v_uid := app.current_user_id();
  if v_uid is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  v_token_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  -- Fix round 1: lock the row so two concurrent accept_invitation calls on
  -- the same token serialise instead of both reading an unaccepted row.
  select * into v_invitation from public.invitations where token_hash = v_token_hash for update;
  if v_invitation.id is null then
    raise exception 'code:not_found' using detail = 'invitation not found';
  end if;

  if v_invitation.accepted_at is not null
    or v_invitation.revoked_at is not null
    or v_invitation.expires_at <= now()
  then
    raise exception 'code:invalid_state' using detail = 'invitation is no longer open';
  end if;

  select email into v_caller_email from auth.users where id = v_uid;
  if lower(v_caller_email) is distinct from v_invitation.email then
    raise exception 'code:forbidden' using detail = 'invitation was issued to a different email address';
  end if;

  if exists (
    select 1 from public.memberships m
    where m.institution_id = v_invitation.institution_id
      and m.user_id = v_uid
      and m.role = v_invitation.role
  ) then
    raise exception 'code:conflict' using detail = 'already a member with this role';
  end if;

  -- Fix round 1: the linked staff/guardians/students row may already belong
  -- to a different account (e.g. a second invitation on the same row) —
  -- reject before inserting a membership for someone else's linked record,
  -- rather than silently skipping the user_id backfill below.
  if v_invitation.staff_id is not null then
    select user_id into v_linked_user_id from public.staff where id = v_invitation.staff_id;
  elsif v_invitation.guardian_id is not null then
    select user_id into v_linked_user_id from public.guardians where id = v_invitation.guardian_id;
  elsif v_invitation.student_id is not null then
    select user_id into v_linked_user_id from public.students where id = v_invitation.student_id;
  end if;
  if v_linked_user_id is not null and v_linked_user_id is distinct from v_uid then
    raise exception 'code:conflict' using detail = 'linked record belongs to another account';
  end if;

  perform set_config('app.allow_membership_bootstrap', 'on', true);
  begin
    insert into public.memberships (institution_id, user_id, role, status, staff_id, guardian_id, student_id)
    values (
      v_invitation.institution_id, v_uid, v_invitation.role, 'active',
      v_invitation.staff_id, v_invitation.guardian_id, v_invitation.student_id
    )
    returning id into v_membership_id;
  exception
    when unique_violation then
      raise exception 'code:conflict' using detail = 'already a member with this role';
  end;
  perform set_config('app.allow_membership_bootstrap', '', true);

  if v_invitation.staff_id is not null then
    update public.staff set user_id = v_uid where id = v_invitation.staff_id and user_id is null;
  elsif v_invitation.guardian_id is not null then
    update public.guardians set user_id = v_uid where id = v_invitation.guardian_id and user_id is null;
  elsif v_invitation.student_id is not null then
    update public.students set user_id = v_uid where id = v_invitation.student_id and user_id is null;
  end if;

  update public.invitations
  set accepted_at = now(), accepted_by = v_uid
  where id = v_invitation.id;

  perform app.audit(
    v_invitation.institution_id, v_uid, 'core.invitation.accepted', 'invitations', v_invitation.id,
    null, null, jsonb_build_object('role', v_invitation.role)
  );

  return v_membership_id;
end;
$$;

revoke execute on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

-- ---------------------------------------------------------------------------
-- revoke_invitation
-- ---------------------------------------------------------------------------

create function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_invitation public.invitations;
begin
  v_uid := app.current_user_id();

  select * into v_invitation from public.invitations where id = p_invitation_id for update;
  if v_invitation.id is null then
    raise exception 'code:not_found' using detail = 'invitation not found';
  end if;

  if not app.has_role(v_invitation.institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:forbidden' using detail = 'only an owner, principal, or admin revokes invitations';
  end if;

  if v_invitation.role = 'owner' and not app.has_role(v_invitation.institution_id, array['owner']) then
    raise exception 'code:forbidden' using detail = 'only an owner revokes an owner invitation';
  end if;

  if v_invitation.role = 'principal' and not app.has_role(v_invitation.institution_id, array['owner', 'principal']) then
    raise exception 'code:forbidden' using detail = 'only an owner or principal revokes a principal invitation';
  end if;

  if v_invitation.accepted_at is not null
    or v_invitation.revoked_at is not null
    or v_invitation.expires_at <= now()
  then
    raise exception 'code:invalid_state' using detail = 'invitation is no longer open';
  end if;

  update public.invitations set revoked_at = now() where id = p_invitation_id;

  perform app.audit(
    v_invitation.institution_id, v_uid, 'core.invitation.revoked', 'invitations', v_invitation.id,
    null, null, jsonb_build_object('role', v_invitation.role)
  );
end;
$$;

revoke execute on function public.revoke_invitation(uuid) from public, anon;
grant execute on function public.revoke_invitation(uuid) to authenticated;
