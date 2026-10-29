-- Fix (T-012): service_role lacks USAGE on schema app.
--
-- service_role has BYPASSRLS, so RLS policy evaluation (which calls
-- app.has_role()/app.is_member() etc.) is skipped entirely for it — that
-- part was never the problem. But BYPASSRLS does not bypass schema-level
-- USAGE checks, and invoking a trigger whose function lives in a schema the
-- firing role lacks USAGE on fails with "permission denied for schema app"
-- — confirmed empirically: inserting into memberships as service_role
-- failed on the validate_membership_link BEFORE INSERT trigger (which calls
-- app.staff_roles()), even though block_mutation/set_updated_at-only tables
-- (no app-schema-calling trigger on INSERT) worked fine. 0001 granted USAGE
-- on schema app to authenticated and anon only; service_role was missed.
grant usage on schema app to service_role;

-- That alone wasn't enough: the next failure was "permission denied for
-- function staff_roles", not for the trigger function itself. A trigger
-- function's own invocation is never ACL-checked against the firing role,
-- but these two trigger functions are SECURITY INVOKER (the default) and
-- call OTHER app.* functions internally — those nested calls DO run under
-- the firing role's privileges, so the firing role needs EXECUTE on
-- whatever they call (app.staff_roles, app.current_user_id, app.audit),
-- none of which were ever granted to service_role (0001 granted them to
-- authenticated only). Making both SECURITY DEFINER (matching
-- app.handle_new_auth_user's and app.enrolment_status_changed's pattern)
-- means the nested calls run as the function owner (postgres) instead,
-- which always has access — fixes it for every future role, not just
-- service_role, without hunting down every nested-call grant individually.
alter function app.validate_membership_link() security definer;
alter function app.membership_changed() security definer;
