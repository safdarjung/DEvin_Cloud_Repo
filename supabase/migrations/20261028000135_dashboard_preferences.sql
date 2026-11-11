-- Per-user home dashboard layout ({hidden, order} widget ids). Own row only,
-- same shape as study_preferences (0049). The page decides which widgets a user
-- may see; this row only hides or reorders them.
create table public.dashboard_preferences (
  institution_id uuid not null references public.institutions (id),
  user_id uuid not null references public.profiles (id),
  layout jsonb not null default '{}'::jsonb check (jsonb_typeof(layout) = 'object' and pg_column_size(layout) <= 4096),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (institution_id, user_id)
);

create trigger set_updated_at
before update on public.dashboard_preferences
for each row execute function app.set_updated_at();

alter table public.dashboard_preferences enable row level security;

create policy dashboard_preferences_select on public.dashboard_preferences
  for select to authenticated
  using (user_id = app.current_user_id() and app.is_member(institution_id));

create policy dashboard_preferences_insert on public.dashboard_preferences
  for insert to authenticated
  with check (user_id = app.current_user_id() and app.is_member(institution_id));

create policy dashboard_preferences_update on public.dashboard_preferences
  for update to authenticated
  using (user_id = app.current_user_id())
  with check (user_id = app.current_user_id() and app.is_member(institution_id));

create policy dashboard_preferences_delete on public.dashboard_preferences
  for delete to authenticated
  using (user_id = app.current_user_id());

revoke all on public.dashboard_preferences from anon;
grant select, insert, update, delete on table public.dashboard_preferences to authenticated;
grant all on table public.dashboard_preferences to service_role;
