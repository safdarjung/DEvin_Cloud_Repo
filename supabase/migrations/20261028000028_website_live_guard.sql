-- T-042 / DBT-28: `websites_write`/`websites_update` (0010) are website.edit
-- policies (owner/principal/admin/admissions), so admissions could take the
-- public site live or offline with a direct PostgREST write; `website.publish`
-- (owner/principal/admin, 07 §2.2) was enforced only in T-025's
-- `setWebsiteLive` action. This trigger enforces it on every write path:
-- `is_live` may be set true on INSERT, or changed on UPDATE, only by a
-- website.publish role of that institution. Same service_role/postgres
-- bypass as 0016 (seed, fixtures). Security invoker: `app.has_role` is the
-- existing definer RLS helper (0001), already executable by `authenticated`.

create function app.guard_website_live()
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

  if (
      (tg_op = 'INSERT' and new.is_live)
      or (tg_op = 'UPDATE' and new.is_live is distinct from old.is_live)
    )
    and not app.has_role(new.institution_id, array['owner', 'principal', 'admin'])
  then
    raise exception 'code:forbidden' using detail = 'websites.is_live changes need website.publish';
  end if;

  return new;
end;
$$;

revoke execute on function app.guard_website_live() from public;

create trigger guard_website_live
before insert or update on public.websites
for each row execute function app.guard_website_live();
