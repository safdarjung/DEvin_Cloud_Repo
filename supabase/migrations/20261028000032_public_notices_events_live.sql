-- T-042 security review (MEDIUM): `notices_anon_select`/`events_anon_select`
-- (0010) let anon read every `is_public` notice/event of any institution,
-- even one whose website was never taken live — unlike pages/page_versions,
-- whose anon policies require `websites.is_live`. Same live-site check here.
-- The subquery runs under websites' own anon policy (live rows only).

drop policy notices_anon_select on public.notices;
create policy notices_anon_select on public.notices
  for select to anon
  using (
    is_public = true
    and publish_at <= now()
    and (expires_at is null or expires_at > now())
    and exists (
      select 1 from public.websites w
      where w.institution_id = notices.institution_id and w.is_live = true
    )
  );

drop policy events_anon_select on public.events;
create policy events_anon_select on public.events
  for select to anon
  using (
    is_public = true
    and exists (
      select 1 from public.websites w
      where w.institution_id = events.institution_id and w.is_live = true
    )
  );
