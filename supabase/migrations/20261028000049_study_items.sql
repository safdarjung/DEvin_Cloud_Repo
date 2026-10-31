-- 0049 — GU-07 (14-generative-ui-plan.md, D32): student study notebook
-- tables. D32: student-only, ever — no guardian/teacher/owner/principal/
-- admin exception anywhere in this file's RLS. Hard delete is allowed for
-- the owning student (not immutable, unlike audit_events/results/payments
-- — this is the student's own scratch content, not a trust record).
--
-- database-reviewer (Opus, 2026-10-31) found one HIGH before this landed:
-- `source_chat_id` had no `on delete` clause, so a NOT NULL-columns
-- `study_items` row referencing a chat via `source_chat_id` would block
-- that chat's own delete with a 23503 — breaking D32 point 3's "hard
-- delete at any time" for the exact case GU-09's "Make notes" creates.
-- Fixed below with `on delete set null` plus an index on the FK column
-- (unindexed FK columns make every DELETE on this table an O(n) scan for
-- the constraint check). Also fixed from that review: `study_preferences`
-- had no DELETE policy despite D32 point 3 covering "content", not just
-- `study_items`; `skills`/`style` had no size cap, inconsistent with
-- `study_items.content`'s; a trigger now blocks the columns that should
-- never change post-insert (id/kind/created_at/institution_id — `user_id`
-- was already blocked by the UPDATE policy's own `with check`, but
-- `institution_id` was not: a member of two institutions could otherwise
-- move a row between them and escape the origin institution's
-- `demo:reset`, the same class of bug 0038 fixed for `memberships`).

create table public.study_items (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  user_id uuid not null references public.profiles (id),
  kind text not null check (kind in ('chat', 'note')),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  folder text check (char_length(btrim(folder)) between 1 and 60),
  pinned boolean not null default false,
  -- Plan §GU-07's "≈256 KB" content cap. `pg_column_size` measures the
  -- stored jsonb representation (plus a small header), not JSON text
  -- bytes — close enough for a soft cap, not an exact byte-for-byte limit.
  content jsonb not null check (pg_column_size(content) <= 262144),
  -- `set null` (not the default `no action`) so deleting a "chat" row
  -- never fails because a "note" row still points at it as its source —
  -- D32's hard-delete guarantee must hold even then.
  source_chat_id uuid references public.study_items (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index study_items_user_idx on public.study_items (user_id, institution_id, updated_at desc);
create index study_items_source_chat_idx on public.study_items (source_chat_id) where source_chat_id is not null;

create trigger set_updated_at
before update on public.study_items
for each row execute function app.set_updated_at();

-- Blocks changing identity/origin columns after insert — `user_id` is
-- already blocked by the UPDATE policy's own `with check` (below), but
-- RLS alone doesn't stop a member of two institutions from moving a row's
-- `institution_id`, or a client from touching `id`/`kind`/`created_at`,
-- all of which a bare RLS policy can't express (same reasoning as 0038's
-- `guard_membership_write` for `memberships`).
create function app.guard_study_item_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.kind is distinct from old.kind
    or new.created_at is distinct from old.created_at
    or new.institution_id is distinct from old.institution_id
  then
    raise exception 'study_items: id, kind, created_at, and institution_id cannot be changed';
  end if;
  return new;
end;
$$;

revoke execute on function app.guard_study_item_update() from public;

create trigger guard_study_item_update
before update on public.study_items
for each row execute function app.guard_study_item_update();

create table public.study_preferences (
  institution_id uuid not null references public.institutions (id),
  user_id uuid not null references public.profiles (id),
  skills jsonb not null default '[]'::jsonb check (jsonb_typeof(skills) = 'array' and pg_column_size(skills) <= 8192),
  style jsonb not null default '{}'::jsonb check (jsonb_typeof(style) = 'object' and pg_column_size(style) <= 8192),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (institution_id, user_id)
);

create trigger set_updated_at
before update on public.study_preferences
for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — own rows only, for every role. Not role-scoped (class O, same shape
-- as `notifications`, 0003): RLS alone only enforces "yours, and only
-- yours" — it does not restrict this to the student role specifically.
-- The application layer does that (`ai.study` permission, GU-08, student
-- only), the same two-layer split as every other feature in this schema
-- (rule 2): RLS for data, the permission check for who.
-- ---------------------------------------------------------------------------

alter table public.study_items enable row level security;
alter table public.study_preferences enable row level security;

create policy study_items_select on public.study_items
  for select to authenticated
  using (user_id = app.current_user_id() and app.is_member(institution_id));

create policy study_items_insert on public.study_items
  for insert to authenticated
  with check (user_id = app.current_user_id() and app.is_member(institution_id));

create policy study_items_update on public.study_items
  for update to authenticated
  using (user_id = app.current_user_id())
  with check (user_id = app.current_user_id() and app.is_member(institution_id));

create policy study_items_delete on public.study_items
  for delete to authenticated
  using (user_id = app.current_user_id());

create policy study_preferences_select on public.study_preferences
  for select to authenticated
  using (user_id = app.current_user_id() and app.is_member(institution_id));

create policy study_preferences_insert on public.study_preferences
  for insert to authenticated
  with check (user_id = app.current_user_id() and app.is_member(institution_id));

create policy study_preferences_update on public.study_preferences
  for update to authenticated
  using (user_id = app.current_user_id())
  with check (user_id = app.current_user_id() and app.is_member(institution_id));

create policy study_preferences_delete on public.study_preferences
  for delete to authenticated
  using (user_id = app.current_user_id());

-- ---------------------------------------------------------------------------
-- Explicit Data API grants (0045's own precedent for every table through
-- 0044 — harmless if 0045's `alter default privileges for role postgres`
-- already covers tables created after it on hosted, which is unconfirmed;
-- see DBT-39's now-corrected text).
-- ---------------------------------------------------------------------------

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.study_items to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.study_items to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.study_items to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.study_preferences to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.study_preferences to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.study_preferences to service_role;
