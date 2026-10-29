-- D27 (lead fix, reserved in 10 §3): app-layer audit events for src/lib/audit.ts.
-- app.audit() lives in the `app` schema, which PostgREST does not expose, so
-- server actions had no way to write intent-level events (04 §D20). This
-- wrapper is the only app-code path to it: the actor is always the signed-in
-- caller (never a parameter) and the caller must be a member of the target
-- institution. A member can therefore only add events attributed to
-- themselves, in their own institution.

create function public.record_audit_event(
  p_institution_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid default null,
  p_before jsonb default null,
  p_after jsonb default null,
  p_metadata jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.current_user_id();
begin
  if v_actor is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  if not app.is_member(p_institution_id) then
    raise exception 'code:forbidden' using detail = 'caller is not a member of the target institution';
  end if;

  if p_action !~ '^[a-z_]+(\.[a-z_]+)+$' or p_entity_type !~ '^[a-z_]+$' then
    raise exception 'code:validation_failed' using detail = 'action must be dotted lowercase (e.g. attendance.submit); entity_type lowercase';
  end if;

  return app.audit(p_institution_id, v_actor, p_action, p_entity_type, p_entity_id, p_before, p_after, p_metadata);
end;
$$;

revoke execute on function public.record_audit_event(uuid, text, text, uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.record_audit_event(uuid, text, text, uuid, jsonb, jsonb, jsonb) to authenticated;
