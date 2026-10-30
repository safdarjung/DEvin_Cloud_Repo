-- T-042 fix round 1 (review MED): `profiles_update` (0002) lets a user
-- update their own row, and the default table grant covered every column —
-- so any signed-in user could set their own `is_platform_admin = true`
-- (07 §2.1: `demo.reset`, `institution.create`). The app writes no profile
-- column today; keep only the self-editable display fields updatable.
-- `updated_at` is set by the set_updated_at trigger, not by the caller.

revoke update on public.profiles from anon, authenticated;
grant update (full_name, phone, avatar_path) on public.profiles to authenticated;
