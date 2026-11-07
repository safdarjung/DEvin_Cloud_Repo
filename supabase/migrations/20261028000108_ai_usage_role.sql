-- T3b (ai-roles): ai_usage_events.role — the membership role that made the
-- call, so usage/quota can be sliced per role (06 §W10 per-role quota,
-- ai.usageByRole query). Nullable, no backfill: app.block_mutation already
-- forbids UPDATE on this table, so existing rows simply predate the column.

alter table public.ai_usage_events
  add column role text;

create index ai_usage_events_institution_role_created_idx
  on public.ai_usage_events (institution_id, role, created_at);
