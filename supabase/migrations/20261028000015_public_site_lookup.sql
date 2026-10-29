-- T-024 fix (lead ruling, DBT-11): the public site renderer needs to
-- resolve an institution by its slug as an anonymous visitor, but
-- `public.institutions` has no anon SELECT policy and must not get one —
-- a policy scoped by "its website is live" would still expose every other
-- institutions column (`settings`, `ai_policy`) to anon, not just the
-- slug/name the renderer needs.
--
-- `public.get_public_site` is the narrow alternative: a `security definer`
-- function that returns exactly the five columns the renderer uses
-- (institution_id, institution_name, website_id, theme, nav), and only one
-- row, and only when that institution's website `is_live` — never when the
-- slug is unknown or the site is offline (zero rows either way, same as
-- the anon RLS predicates on websites/pages/page_versions/notices/events,
-- 05 §5 class P). No dynamic SQL; both tables are referenced by qualified
-- name so this resolves correctly regardless of `search_path`.
create function public.get_public_site(p_slug text)
returns table (
  institution_id uuid,
  institution_name text,
  website_id uuid,
  theme jsonb,
  nav jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.name, w.id, w.theme, w.nav
  from public.institutions i
  join public.websites w on w.institution_id = i.id
  where i.slug = p_slug and w.is_live = true
  limit 1;
$$;

revoke execute on function public.get_public_site(text) from public;
grant execute on function public.get_public_site(text) to anon, authenticated;
