-- 0144 — atomic institutions.settings patches (security review 2026-11-11,
-- "settings lost update"). core.feature.set, core.ai_role.set, core.module.set
-- and the setup wizard each wrote the WHOLE settings jsonb back from the copy
-- read at request start, so two admins (or two tabs) saving at once silently
-- reverted each other, a switch-off coming back on included. They now send
-- only what changed, and this merges it into the row as it is at write time.
--
-- public.patch_institution_settings(p_institution_id, p_patch) -> new settings
--   security definer, search_path ''. The caller must hold owner/principal/
--   admin in that institution: app.has_role, exactly the institutions_update
--   policy (0002). p_patch is an object whose top-level keys may only be
--   modules, features, ai_roles (control centre), branding, setup (setup
--   wizard), each an object: it can never touch locale, ai, finance or any
--   other key, so it is not a generic settings writer (core.institution.
--   updateSettings keeps its own schema-checked path). Merged as a JSON Merge
--   Patch (RFC 7396): objects merge key by key, null removes the key, anything
--   else replaces — the control centre's patch semantics (a null override goes
--   back to the default). One UPDATE: it takes the row lock, and a concurrent
--   writer waits and then merges into the committed row, so no patch is lost.
--   An override map emptied by nulls stays as {} (every read is key-wise).
-- app.jsonb_merge_patch(target, patch): the merge; revoked from everyone.

create function app.jsonb_merge_patch(p_target jsonb, p_patch jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out jsonb;
  v_key text;
  v_value jsonb;
begin
  if jsonb_typeof(p_patch) is distinct from 'object' then
    return p_patch;
  end if;
  v_out := case when jsonb_typeof(p_target) = 'object' then p_target else '{}'::jsonb end;
  for v_key, v_value in select key, value from jsonb_each(p_patch) loop
    if jsonb_typeof(v_value) = 'null' then
      v_out := v_out - v_key;
    else
      v_out := v_out || jsonb_build_object(v_key, app.jsonb_merge_patch(v_out -> v_key, v_value));
    end if;
  end loop;
  return v_out;
end;
$$;

revoke execute on function app.jsonb_merge_patch(jsonb, jsonb) from public, anon, authenticated;

create function public.patch_institution_settings(p_institution_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings jsonb;
begin
  if not app.has_role(p_institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold institution.settings.manage for this institution';
  end if;

  if jsonb_typeof(p_patch) is distinct from 'object'
    or exists (
      select 1 from jsonb_each(p_patch) e
      where e.key not in ('modules', 'features', 'ai_roles', 'branding', 'setup')
        or jsonb_typeof(e.value) <> 'object'
    )
  then
    raise exception 'code:validation_failed' using detail = 'only modules, features, ai_roles, branding and setup can be patched, each as an object';
  end if;

  update public.institutions
  set settings = app.jsonb_merge_patch(settings, p_patch)
  where id = p_institution_id
  returning settings into v_settings;

  return v_settings;
end;
$$;

revoke execute on function public.patch_institution_settings(uuid, jsonb) from public, anon;
grant execute on function public.patch_institution_settings(uuid, jsonb) to authenticated;
