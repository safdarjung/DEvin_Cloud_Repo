-- 0050 — GU-09 security review (M1): the 200-items-per-student cap was
-- enforced only in the app layer (student-study.actions.ts). Any signed-in
-- member could insert directly through the Data API with their own real
-- session (RLS-permitted, 0049's insert policy has no count limit) and
-- skip it entirely; each row allows up to ~256 KB (0049's own content
-- cap), so unbounded inserts could fill a shared database. This trigger
-- is the real backstop; the app-level check stays, only for the friendly
-- message before a round trip to find out.

create function app.guard_study_item_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  item_count int;
begin
  -- Serializes concurrent inserts for the same user so the count-then-
  -- insert check can't race under a burst of parallel saves (GU-09
  -- review M1) — released automatically at transaction end.
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));

  select count(*) into item_count
  from public.study_items
  where user_id = new.user_id and institution_id = new.institution_id;

  if item_count >= 200 then
    raise exception 'code:validation_failed' using detail = 'Saved items limit reached (200). Delete something to save more.';
  end if;

  return new;
end;
$$;

revoke execute on function app.guard_study_item_cap() from public;

create trigger guard_study_item_cap
before insert on public.study_items
for each row execute function app.guard_study_item_cap();
