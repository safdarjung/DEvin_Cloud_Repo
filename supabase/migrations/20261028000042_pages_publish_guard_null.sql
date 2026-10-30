-- T-042 fix round 1 (found, HIGH): `app.guard_pages_published_version` (0010)
-- tested `current_setting('app.allow_publish', true) <> 'on'`. On a
-- connection that has never set `app.allow_publish` (i.e. never ran
-- app.publish_page) the setting is NULL, `NULL <> 'on'` is NULL, and the
-- guard did not raise — so whether a website.edit role (admissions) could
-- publish a draft by writing `pages.published_version_id` directly over
-- PostgREST depended on connection-pool history. `create or replace` from
-- the live definition with `coalesce(..., '')`; nothing else changes.

CREATE OR REPLACE FUNCTION app.guard_pages_published_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if current_setting('app.allow_reset', true) = 'on' then
    return new;
  end if;

  if new.published_version_id is distinct from old.published_version_id
    and coalesce(current_setting('app.allow_publish', true), '') <> 'on'
  then
    raise exception 'code:forbidden' using detail = 'pages.published_version_id may only change via app.publish_page';
  end if;

  return new;
end;
$function$

;
