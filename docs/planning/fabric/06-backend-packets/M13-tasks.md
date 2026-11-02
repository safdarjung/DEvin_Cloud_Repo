# M13 — Operations: facilities, transport, academic calendar

> **LANE B NOTE (controller ruling, overrides any conflicting line below):** this milestone runs in worktree lane B *before* MOD exists. Skip every `module:` field, `requireModule` call and "module disabled → forbidden" test — MOD's retrofit adds them after the merge. Tasks that "wait for MOD" have no MOD dependency here. Exception (M13 holiday block): use the SQL predicate `coalesce((i.settings->'modules'->>'calendar')::boolean, true)` (MOD stores module state at `institutions.settings.modules.<key>`). Other milestones (M08–M10, M17) run concurrently in lane A; their changes are not in this tree.


Source: `07-master-plan-v1-v2.md` §3 M13. Migration `0075` (claimed). No new deps. **Requires milestone MOD merged** (`module?: ModuleKey` on `defineAction`/`defineQuery`/nav). New owning modules: `src/modules/facilities` (assets, maintenance_requests), `src/modules/transport` (transport_vehicles, transport_routes, transport_stops, transport_assignments), `src/modules/calendar` (academic_calendar_events). Replaces fixtures `MaintenanceRequest` and `TransportRoute` (`src/modules/fabric/types.ts`; generators `maintenanceRequests`/`transportRoutes` in `src/modules/fabric/demo/operations.ts`) and the dashboards' "demo events" (`listPublicEvents` → `PublicEvent` widgets on the `today`/`dashboard`/`portal` pages) with the internal `calendar.forRole` → `CalendarEventRow[]`. The website `events` table stays the public list; it is not merged or read by `calendar.*`.

Rulings:
- **Modules (owner directive, MOD).** Every facilities action/query declares `module: "facilities"`, transport `module: "transport"`, calendar `module: "calendar"`. All three default enabled (catalog `default: true`); the demo tenant has all three on. The holiday block on attendance applies only while `calendar` is enabled: the trigger calls MOD's SQL predicate. If MOD shipped none, T2 adds `app.module_enabled(p_institution_id uuid, p_key text) returns boolean` (stable, definer, `search_path=''`) reading MOD's storage with MOD's defaults exactly. The controller confirms which before dispatching T2. Never invent a second store. Exactly one "module disabled → forbidden" test (T12).
- **Permissions.** New `facilities.manage` = owner, principal, admin. New `transport.manage` = owner, principal, admin. New `maintenance.request` = all 7 staff roles (raise + list own; the plan's key list omits it, but teachers must be able to report faults). Calendar reuses `academics.manage` (write) and `academics.read` (read). `transport.forStudent` uses `student.read` (`s` for teacher/student/guardian; RLS scopes). Guardians/students write nothing in M13.
- **Tables.** All have `institution_id`, `created_at`/`updated_at` + `app.set_updated_at()`, RLS on, every user-supplied FK bound to the same institution in `with check` (lesson 2), initPlan helpers only (lesson 7). Constraint names are fixed so actions map `23505` by name.
  - `assets`: name 1–80; category in (furniture, electrical, it, lab, sports, plumbing, vehicle, other); asset_tag 1–40 null (`assets_tag_key` unique (institution_id, asset_tag)); room_id → rooms null; location 1–80 null; status in (in_use, under_repair, retired) default in_use. No delete (retire instead).
  - `maintenance_requests`: asset_id → assets null; location 1–80 null; check (asset_id is not null or location is not null); issue 1–500; priority low|medium|high default medium; status open|in_progress|done default open; raised_by → profiles (= `app.current_user_id()`); raised_at timestamptz default now(); assignee_staff_id → staff null; assigned_at; closed_at; closed_by → profiles; resolution_note ≤ 500. No delete.
  - `transport_vehicles`: registration_no 1–20 (`transport_vehicles_registration_key` unique per institution); capacity 1–100; driver_name 1–80 (no phone column: PII stays out); status active|off_road default active.
  - `transport_routes`: name 1–60 (`transport_routes_name_key` unique per institution); vehicle_id → transport_vehicles null; status on_time|delayed|off_road default on_time (set by staff, never computed).
  - `transport_stops`: route_id → transport_routes; seq 1–50 (`transport_stops_seq_key` unique (route_id, seq)); name 1–80; pickup_time time; map_x, map_y smallint 0–100 (schematic position, not GPS); unique (id, route_id) as the composite-FK target.
  - `transport_assignments`: one row per student = the current assignment (`transport_assignments_student_key` unique (student_id)); student_id → students; route_id; stop_id; FK (stop_id, route_id) → transport_stops (id, route_id), so a stop can never belong to another route; assigned_by → profiles. Change = upsert on student_id (one atomic statement); unassign = delete. History lives only in audit (debt row).
  - `academic_calendar_events`: academic_year_id → academic_years; kind holiday|exam_week|ptm|event; title 1–120; description ≤ 1000 null; starts_on, ends_on date (ends ≥ starts, span ≤ 92 days); audience all|staff default all; check (kind <> 'holiday' or audience = 'all'); created_by → profiles. Trigger `app.validate_calendar_event_dates` (mirror `app.validate_term_dates`) raises `code:validation_failed` when dates fall outside the year. Delete allowed for managers. Whole-school only: no per-grade scope (debt).
- **RLS (07 §2.2, lesson 1).**
  - assets: SELECT 7 staff roles. INSERT/UPDATE owner/principal/admin, room bound.
  - maintenance_requests: SELECT owner/principal/admin all; other staff `raised_by = (select app.current_user_id())`. INSERT 7 staff roles with raised_by = current user, status open, assignee/assigned_at/closed_* null, asset bound. UPDATE owner/principal/admin, assignee bound via `app.staff_in_institution`.
  - transport_vehicles/routes/stops: SELECT 7 staff roles all. Guardian/student only their own assignment's rows: routes `id = any((select app.my_transport_route_ids()))`; stops `id = any((select app.my_transport_stop_ids()))` (own stop only, never the route's other stops); vehicles via `exists` over those route ids. Writes owner/principal/admin, FKs bound.
  - transport_assignments: SELECT owner/principal/admin/admissions/accountant/exam_controller all (their `student.read` is ✓); teacher `student_id = any((select app.my_taught_student_ids()))`; guardian/student `student_id = any((select app.my_student_ids()))`. INSERT/UPDATE/DELETE owner/principal/admin, student/route bound.
  - academic_calendar_events: SELECT 7 staff roles all; guardian/student `audience = 'all'` in their institution. INSERT/UPDATE/DELETE owner/principal/admin, year bound.
  - New definer helpers `app.my_transport_route_ids()` and `app.my_transport_stop_ids()`: setof uuid over `app.my_student_ids()`; mirror `app.my_student_section_ids` (0020) for grants and revokes (lesson 4).
- **Guards and state machines** (lesson 3: direct PostgREST writes obey the same rules as the actions).
  - Maintenance: trigger `app.guard_maintenance_requests_update`. `done` is terminal: any update → `code:invalid_state`. Allowed moves: open→in_progress (assignee required), in_progress→in_progress (reassign), open|in_progress→done. in_progress→open is rejected. institution_id, raised_by, raised_at, issue, asset_id and location are immutable (`code:invalid_state`). The trigger stamps assigned_at when the assignee changes and closed_at/closed_by on → done; client values for these are overwritten.
  - Capacity: trigger `app.guard_transport_capacity` (definer) BEFORE INSERT OR UPDATE OF route_id on transport_assignments. It locks the route row and counts the other assignments on that route. If the route has a vehicle and the count ≥ its capacity → `code:conflict` detail `route is full`. A route with no vehicle has no cap. Lowering a vehicle's capacity below the assigned count is allowed (the route then shows over capacity).
  - Holiday: trigger `app.block_attendance_on_holiday` (definer) BEFORE INSERT on `attendance_sessions`. It covers upserts and M08's period sessions. When `calendar` is enabled and a `holiday` event covers `new.date` → `code:invalid_state` detail `attendance cannot be taken on a school holiday`. No service-role bypass (seeded holidays never overlap seeded sessions). `attendance.mark` already maps it through `throwMapped` → 409. **Do not edit `src/modules/attendance/*`** (M08 owns it now). Staff attendance (M08) is not blocked (debt). Declaring a holiday over dates with existing sessions is allowed; those sessions stay.
- **ErrorCode mapping (actions).** `23505` by constraint name → `conflict` + fieldErrors (`registrationNo`, `name`, `seq`, `assetTag`, `studentId`). `42501` → `forbidden`. `23503` → `not_found`. `23514` → `validation_failed`. Trigger `code:*` passes through `mapSqlError` (`invalid_state`, `conflict`, `validation_failed`). Update/delete that hits 0 rows → `not_found`. Module disabled → `forbidden` (MOD's wrapper).
- **Audit.** Every action audits ids, status, kind, dates and counts only. Never issue text, resolution notes, names or titles (lesson 10).
- **Honesty.** M13 sends no messages, so no `<SimulatedBadge />`. Transport is `<LimitedBadge>` "Manual status — no live GPS; map is schematic" (status is set by staff; x/y are not coordinates). 03-feature-matrix F-SVC-02 = limited (T13). Maintenance assign/close sends no notification (skipped).

Routing: T1 haiku none [] ; T2 sonnet exclusive [] ; T3 haiku none [] ; T4 haiku none [] ; T5 sonnet tests [1,2,3] ; T6 sonnet tests [1,2,4] ; T7 sonnet tests [1,2,3] ; T8 sonnet tests [1,2,3] ; T9 sonnet tests [1,2,4] ; T10 sonnet tests [1,2,3] ; T11 sonnet exclusive [2] ; T12 sonnet tests [5,6,7,8,9,10] ; T13 haiku none [11,12]

Parallel: T1 ‖ T2 ‖ T3 ‖ T4 → T5 ‖ T6 ‖ T7 ‖ T8 ‖ T9 ‖ T10 (own fixture institutions); T11 runs alone (exclusive) → T12 → T13.

Every new action: manifest import in `src/app/api/v1/actions/all-actions.ts` + C-03 fixture in `tests/security/escalation.test.ts`. Every new query: `query-defs.ts` + `src/app/api/v1/query/all-queries.ts` + smoke sample in `tests/db/api-query-route.test.ts`. Seed-imported files: relative `.ts` imports only. Single-file db runs: `pnpm test:db tests/db/x.test.ts` (no `--`).

---

### Task 1: M13-T1 Permissions + module keys (Haiku)
READ: BRIEF-COMMON.md; rulings (Modules, Permissions); commit `4e6542b` (M07-T1, same files)
FILES: `src/lib/auth/permissions.ts` (union + grants; append at each role's tail — M08–M10 edit the same file); `tests/unit/permissions.test.ts`; `docs/planning/coolskool/07-security-and-ai-governance.md` §2.2 (3 rows); + MOD's module catalog entries `facilities`/`transport`/`calendar` (default enabled) only if MOD lacks them
EXPORTS: `Permission` += `facilities.manage`, `transport.manage`, `maintenance.request`; grants per rulings.
TEST FIRST: teacher has `maintenance.request` but not `facilities.manage`; guardian and student have none of the three; admin has all three; accountant has `maintenance.request` only; matrix test matches 07 §2.2.
ACCEPT: `pnpm test tests/unit/permissions.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 2: M13-T2 Migration 0075 — assets, maintenance, transport, calendar, holiday block
READ: BRIEF-COMMON.md; rulings; `supabase/migrations/20261028000069_timetable.sql` (RLS, FK binding, guards, named constraints), `…0020_rls_performance.sql` (`app.my_student_section_ids` shape), `…0006_attendance.sql` (attendance_sessions), `app.validate_term_dates` (grep); MOD's module predicate
FILES: `supabase/migrations/20261028000075_operations.sql`; `tests/db/operations-rls.test.ts`; `src/lib/db/types.ts` (regen); + `tests/security/rls-expectations.ts` entries for the 7 tables (shared registry)
EXPORTS: 7 tables + constraints + RLS per rulings; helpers `app.my_transport_route_ids()`, `app.my_transport_stop_ids()`; triggers `app.guard_maintenance_requests_update`, `app.guard_transport_capacity`, `app.block_attendance_on_holiday`, `app.validate_calendar_event_dates`; `app.module_enabled` only if MOD lacks it. Indexes: maintenance_requests (institution_id, status); transport_stops (route_id); transport_assignments (route_id), (stop_id); academic_calendar_events (institution_id, kind, starts_on, ends_on). Size: one migration necessarily exceeds ~150 lines (precedent M07-T2).
TEST FIRST: guardian sees own child's route, own stop only (not the route's other stops), its vehicle, and only own child's assignment; guardian B cannot see A's stop or assignment; teacher sees assignments of taught students only, accountant sees all; assignment beyond vehicle capacity → `code:conflict`; second row for the same student → 23505; teacher raises a request with status forced open, cannot read another teacher's request, cannot update; admin open→in_progress→done; done→open and any edit of a done request rejected; holiday covering a date → attendance_sessions insert rejected `code:invalid_state`; exam_week does not block; `calendar` disabled → holiday no longer blocks; guardian cannot read a staff-audience event; holiday with audience staff → 23514; event outside its academic year → `code:validation_failed`; admin of A cannot reference B's room/asset/vehicle/route/stop/student/year.
ACCEPT: `pnpm db:reset`; `pnpm test:db tests/db/operations-rls.test.ts`; `pnpm test:security` (expectations updated — say so); `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 3: M13-T3 Facilities + calendar Zod schemas (Haiku)
READ: BRIEF-COMMON.md; rulings; `src/modules/timetable/schemas.ts` (style); `src/lib/schemas/common.ts` (`uuid`, `isoDate`)
FILES: `src/modules/facilities/schemas.ts`; `src/modules/calendar/schemas.ts` (relative `.ts` imports); `tests/unit/facilities-calendar-schemas.test.ts`
EXPORTS: facilities: `ASSET_CATEGORIES`, `ASSET_STATUSES`, `MAINTENANCE_PRIORITIES`, `MAINTENANCE_STATUSES`; `AssetUpsertSchema` {id?, name 1–80, category, assetTag? 1–40, roomId? uuid, location? 1–80, status?}; `MaintenanceRequestSchema` {assetId? uuid, location? 1–80, issue 1–500, priority default "medium"} refine assetId or location; `MaintenanceAssignSchema` {requestId, assigneeStaffId}; `MaintenanceCloseSchema` {requestId, resolutionNote? ≤ 500}; `AssetListSchema` {roomId?, status?}; `MaintenanceListSchema` {status?, limit? int 1–200}. calendar: `CALENDAR_EVENT_KINDS`, `CALENDAR_AUDIENCES`; `CalendarEventUpsertSchema` {id?, academicYearId, kind, title 1–120, description? ≤ 1000, startsOn, endsOn, audience? default "all"} refine endsOn ≥ startsOn, span ≤ 92 days, holiday ⇒ audience all; `CalendarEventDeleteSchema` {id}; `CalendarForRoleSchema` {from?, to?, kinds? 1–4} refine from ≤ to, span ≤ 366 days. All `.strict()`; inferred `*Input` types exported.
TEST FIRST: valid inputs parse; request with neither assetId nor location rejected; 501-char issue rejected; endsOn before startsOn rejected; holiday with audience staff rejected; 93-day event rejected; unknown key rejected.
ACCEPT: `pnpm test tests/unit/facilities-calendar-schemas.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 4: M13-T4 Transport Zod schemas (Haiku)
READ: BRIEF-COMMON.md; rulings; `src/modules/timetable/schemas.ts` ("HH:MM" pattern)
FILES: `src/modules/transport/schemas.ts` (relative `.ts` imports); `tests/unit/transport-schemas.test.ts`
EXPORTS: `VEHICLE_STATUSES`, `ROUTE_STATUSES`; `VehicleUpsertSchema` {id?, registrationNo 1–20 (trim, uppercase, inner spaces removed), capacity int 1–100, driverName 1–80, status?}; `RouteUpsertSchema` {id?, name 1–60, vehicleId? uuid | null, status?}; `StopUpsertSchema` {id?, routeId, seq int 1–50, name 1–80, eta "HH:MM" 24h, mapX int 0–100, mapY int 0–100}; `TransportAssignSchema` {studentId, stopId}; `TransportUnassignSchema` {studentId}; `TransportRoutesSchema` {}; `TransportForStudentSchema` {studentId}. All `.strict()`; inferred `*Input` types exported.
TEST FIRST: valid inputs parse; eta "7:5" rejected; capacity 0 and 101 rejected; mapX 101 rejected; registration " mh 12 ab 1234 " → "MH12AB1234"; unknown key rejected.
ACCEPT: `pnpm test tests/unit/transport-schemas.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 5: M13-T5 Facilities actions
READ: BRIEF-COMMON.md; rulings; T2 migration; T3 schemas; `src/modules/timetable/actions.ts` (`throwMapped`, 23505/42501 mapping); MOD's `module` option
FILES: `src/modules/facilities/actions.ts` (`"use server"`); `tests/db/facilities-actions.test.ts`; + manifest line + C-03 fixtures
EXPORTS (all `module: "facilities"`, audited per rulings): `upsertAsset` = `facilities.asset.upsert` (`facilities.manage`) → {id}; `raiseMaintenanceRequest` = `maintenance.request` (`maintenance.request`) → {id}; `assignMaintenanceRequest` = `maintenance.assign` (`facilities.manage`; sets assignee + status in_progress) → {id, status}; `closeMaintenanceRequest` = `maintenance.close` (`facilities.manage`; status done + note) → {id, status}.
TEST FIRST: teacher raises → open with raised_by = teacher; teacher assign → forbidden; admin assign → in_progress; close → done; close again → invalid_state; duplicate assetTag → conflict with fieldErrors.assetTag; assignee from another institution → forbidden; unknown request id → not_found.
ACCEPT: `pnpm test:db tests/db/facilities-actions.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm test:security tests/security/escalation.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 6: M13-T6 Transport actions
READ: BRIEF-COMMON.md; rulings; T2 migration; T4 schemas; `src/modules/timetable/actions.ts` (mapping style)
FILES: `src/modules/transport/actions.ts` (`"use server"`); `tests/db/transport-actions.test.ts`; + manifest line + C-03 fixtures
EXPORTS (all `module: "transport"`, `transport.manage`, audited ids/counts): `upsertVehicle` = `transport.vehicle.upsert` → {id}; `upsertRoute` = `transport.route.upsert` → {id}; `upsertStop` = `transport.stop.upsert` (eta → pickup_time) → {id}; `assignTransport` = `transport.assign` (route_id read from the stop; upsert on student_id) → {id, routeId, stopId}; `unassignTransport` = `transport.unassign` → {studentId}, not_found when no assignment.
TEST FIRST: vehicle capacity 2 + route + 2 stops, assign 2 students; a third → conflict "route is full"; moving a student to the other stop keeps one row; duplicate registration → conflict with fieldErrors.registrationNo; duplicate stop seq → conflict with fieldErrors.seq; teacher → forbidden; unassign twice → not_found; a stop from another institution → forbidden.
ACCEPT: `pnpm test:db tests/db/transport-actions.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm test:security tests/security/escalation.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 7: M13-T7 Calendar actions
READ: BRIEF-COMMON.md; rulings; T2 migration; T3 schemas; `src/modules/timetable/actions.ts` (mapping style)
FILES: `src/modules/calendar/actions.ts` (`"use server"`); `tests/db/calendar-actions.test.ts`; + manifest line + C-03 fixtures
EXPORTS (all `module: "calendar"`, `academics.manage`, audited id/kind/dates): `upsertCalendarEvent` = `calendar.event.upsert` → {id}; `deleteCalendarEvent` = `calendar.event.delete` → {id}, not_found when 0 rows.
TEST FIRST: admin creates a holiday and a staff-only event; event outside the academic year → validation_failed; year from another institution → forbidden; teacher → forbidden; delete twice → not_found; update changes dates in place (same id).
ACCEPT: `pnpm test:db tests/db/calendar-actions.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm test:security tests/security/escalation.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 8: M13-T8 Facilities queries
READ: BRIEF-COMMON.md; rulings; `MaintenanceRequest` in `src/modules/fabric/types.ts`; `src/modules/timetable/queries.ts` + `query-defs.ts` (pattern, institution timezone)
FILES: `src/modules/facilities/queries.ts`; `src/modules/facilities/query-defs.ts`; `tests/db/facilities-queries.test.ts`; + `all-queries.ts` line + smoke samples
EXPORTS (all `module: "facilities"`, permission `maintenance.request`; RLS scopes): `facilities.assets` {roomId?, status?} → `AssetRow[]` = {id, name, category, assetTag: string | null, room: string | null, location: string | null, status} (exported type); `facilities.maintenanceRequests` {status?, limit?} → `MaintenanceRequest[]` exactly: asset = asset name ?? "General"; location = request location ?? asset's room name ?? asset location ?? ""; raised_at = YYYY-MM-DD in institution timezone; assignee = staff full name or null (if staff RLS hides the name from the caller → null; do not widen staff RLS); order priority high→low, then raised_at desc.
TEST FIRST: admin sees all requests in the fixture shape; teacher sees only own; asset-less request shows its location and asset "General"; status filter works; guardian → forbidden.
ACCEPT: `pnpm test:db tests/db/facilities-queries.test.ts tests/db/api-query-route.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: `MaintenanceRequest` (`maintenanceRequests` generator)

### Task 9: M13-T9 Transport queries
READ: BRIEF-COMMON.md; rulings; `TransportRoute` in `src/modules/fabric/types.ts`; `src/modules/timetable/queries.ts` + `query-defs.ts` (pattern)
FILES: `src/modules/transport/queries.ts`; `src/modules/transport/query-defs.ts`; `tests/db/transport-queries.test.ts`; + `all-queries.ts` line + smoke samples
EXPORTS (all `module: "transport"`): `transport.routes` {} (`transport.manage`) → `TransportRoute[]` exactly: vehicle = registration_no ?? "", driver = driver_name ?? "", stops ordered by seq {name, eta "HH:MM", students = assignments at that stop, x = map_x, y = map_y}, status = route status, capacity = vehicle capacity ?? 0, assigned = assignments on the route; `transport.forStudent` {studentId} (`student.read`) → `StudentTransport | null` = {studentId, routeId, routeName, vehicle: string | null, driver: string | null, status, stop: {name, eta}} (exported type); null when there is no assignment or RLS hides it.
TEST FIRST: routes counts match assignments; stops ordered by seq with x/y; guardian forStudent own child → own stop; another family's child → null; teacher forStudent of a non-taught student → null; teacher `transport.routes` → forbidden.
ACCEPT: `pnpm test:db tests/db/transport-queries.test.ts tests/db/api-query-route.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: `TransportRoute` (`transportRoutes` generator)

### Task 10: M13-T10 Calendar query
READ: BRIEF-COMMON.md; rulings; `src/modules/timetable/query-defs.ts` (pattern); `todayInTimezone` usage in `src/modules/attendance/actions.ts`
FILES: `src/modules/calendar/queries.ts`; `src/modules/calendar/query-defs.ts`; `tests/db/calendar-queries.test.ts`; + `all-queries.ts` line + smoke sample
EXPORTS (`module: "calendar"`, `academics.read`): `calendar.forRole` {from?, to?, kinds?} → `CalendarEventRow[]` = {id, kind, title, description: string | null, startsOn, endsOn, audience} (exported type). Default window = today … today + 90 days in the institution timezone; returns events overlapping the window, ordered by startsOn; RLS hides staff-audience events from guardians/students.
TEST FIRST: staff sees staff and all-audience events; guardian sees only audience all; an event starting before `from` and ending inside the window is included; kinds filter works; default window with a mocked clock.
ACCEPT: `pnpm test:db tests/db/calendar-queries.test.ts tests/db/api-query-route.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: dashboards' demo events (`listPublicEvents` widgets) — internal calendar

### Task 11: M13-T11 Seed section `operations`
READ: BRIEF-COMMON.md; `scripts/seed/index.ts`; `scripts/seed/sections/timetable.ts` (rooms, `uuidV5`, `insertBatch`); `scripts/seed/sections/attendance.ts` (`HOLIDAYS`); `scripts/seed/sections/exams.ts` (exam dates); 05 §8.1 (`guardian.one` children); `tests/db/seed-timetable.test.ts`
FILES: `scripts/seed/sections/operations.ts` (new); `scripts/seed/index.ts` (register after timetable); `tests/db/seed-operations.test.ts` (new); + `tests/db/seed-determinism.test.ts` table list if it enumerates tables
EXPORTS: deterministic (`uuidV5`). ~20 assets (projectors in the first rooms, lab kit, hall sound system, generator). 8 maintenance requests (3 open, 3 in_progress assigned to office staff, 2 done) raised by seeded staff users. 4 vehicles (capacity 40), 4 routes × 6 stops (pickup 07:00–07:50, schematic x/y), ~30 students per route incl. Aarav and Ananya Sharma on Route 1 stop 3 (must hold at `SEED_SCALE=small`). Calendar for 2026-27: holidays exactly the attendance seed's `HOLIDAYS` (2026-10-20…22 as one event) + 2026-12-25 + 2027-01-26; exam_week events matching the exams seed dates; PTM 2026-11-21; Annual Day (match the website event date if one exists); one staff-only training day. Enable `facilities`/`transport`/`calendar` for the demo tenant if MOD stores per-tenant state. Bulk inserts via `insertBatch`.
TEST FIRST: demo tenant has 4 routes with ≥ 5 stops each; Aarav has an assignment; no route over capacity; no attendance session falls on a seeded holiday; `guardian.one` reads exactly one stop per child's route; reseed gives identical ids.
ACCEPT: `DEMO_RESET_ALLOWED=true pnpm demo:reset` (you are the seed owner); `pnpm test:db tests/db/seed-operations.test.ts tests/db/seed-determinism.test.ts`; `pnpm lint`; `pnpm typecheck`
NOTE: e2e journeys that mark attendance "today" will fail only on 2026-12-25 / 2027-01-26 (real holidays) — expected.
REPLACES FIXTURE: none

### Task 12: M13-T12 Acceptance over HTTP
READ: BRIEF-COMMON.md; `tests/db/timetable-acceptance.test.ts` (HTTP helpers); MOD's module toggle
FILES: `tests/db/operations-acceptance.test.ts`
TEST: admin via `/api/v1/actions/*` builds vehicle, route, 3 stops; assigns child A (guardian G1) to stop 2 and child B (guardian G2) to stop 3. G1 `GET /api/v1/query/transport.forStudent` for A → stop 2; for B → null; G1 PostgREST `transport_stops` → only stop 2. Admin declares a holiday today (`calendar.event.upsert`) → admin `attendance.mark` today → 409 `invalid_state`. Guardian `calendar.forRole` sees the holiday, not a staff-only event. Teacher `maintenance.request` → admin `maintenance.assign` → `maintenance.close` → teacher `facilities.maintenanceRequests` shows done. **Module disabled → forbidden (the one test):** disable `transport` via MOD's toggle → `transport.assign` and `transport.routes` → 403 `forbidden`; re-enable.
ACCEPT: `pnpm test:db tests/db/operations-acceptance.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 13: M13-T13 Docs (Haiku)
READ: rulings; T2 migration (facts only)
FILES: `docs/planning/coolskool/07-security-and-ai-governance.md` §4 (one row: 0075 definers and guards — transport helpers, capacity, holiday block, maintenance guard, calendar dates); `docs/planning/coolskool/05-data-architecture.md` (owner rows for the 7 tables; remove `transport_*` from the reserved-names line); `docs/planning/coolskool/03-feature-matrix.md` (F-SVC-02 → limited: routes/stops/assignments, manual status, no GPS, no transport-fee linkage)
ACCEPT: `pnpm lint`; every fact matches the migration
REPLACES FIXTURE: none

---

Controller after T13: backlog index 0075 built; `12-decision-log.md` §Debt rows (assignment history via audit only; no per-grade holidays; staff attendance not holiday-blocked; no GPS / transport fees; no notification on maintenance assign/close; withdrawn students keep their transport row until M14); security review (Sonnet); full gate; commit/push; hosted push owner-run; `DONE M13 <sha>`.
