import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// T-042 AC3: every function's EXECUTE grants match 07 §4. The query lives in
// scripts/audit-grants.sql so the same output can be pasted into a report.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 1 });

interface FnRow {
  schema: string;
  name: string;
  security: "definer" | "invoker";
  is_trigger: boolean;
  search_path: string;
  anon: boolean;
  authenticated: boolean;
  service_role: boolean;
}

let rows: FnRow[];
const names = (filter: (r: FnRow) => boolean) =>
  [...new Set(rows.filter(filter).map((r) => `${r.schema}.${r.name}`))].sort();

beforeAll(async () => {
  rows = (await sql.unsafe(fs.readFileSync(path.join(process.cwd(), "scripts/audit-grants.sql"), "utf8"))) as unknown as FnRow[];
});

afterAll(async () => {
  await sql.end();
});

// RLS helpers: called from policies as the querying role, so `authenticated`
// needs EXECUTE (07 §4 "RLS helpers"). Nothing else in `app` is callable by a user.
const APP_AUTHENTICATED = [
  // M04-T3 — commit_import_batch is security invoker, so its own app.*
  // helpers (audit wrapper, batch-lock peek, guardian_students insert
  // wrapper — see 20261028000066_imports.sql comments) need EXECUTE for
  // `authenticated` the same as any RLS helper would.
  "app.audit_import_commit",
  "app.current_user_id",
  "app.exam_roles",
  "app.exam_write_roles",
  "app.finance_roles",
  "app.finance_void_roles",
  "app.finance_write_roles",
  "app.guardian_student_ids",
  "app.has_role",
  "app.import_insert_guardian_student",
  "app.is_member",
  "app.is_platform_admin",
  "app.lock_import_batch",
  "app.member_institutions",
  "app.my_class_teacher_section_ids",
  "app.my_class_teacher_student_ids",
  "app.my_guardian_ids",
  "app.my_guardian_student_ids",
  "app.my_institution_ids",
  "app.my_report_ids",
  "app.my_staff_ids",
  "app.my_student_ids",
  "app.my_student_section_ids",
  "app.my_taught_section_ids",
  "app.my_taught_section_subjects",
  "app.my_taught_student_ids",
  "app.my_transport_route_ids",
  "app.my_transport_stop_ids",
  "app.my_transport_vehicle_ids",
  "app.own_student_id",
  "app.staff_id",
  "app.staff_in_institution",
  "app.staff_roles",
  "app.teacher_sees_guardian",
  "app.teaches_section",
];

// public.* security-definer RPCs a signed-in user may call (each role-checks inside).
const PUBLIC_AUTHENTICATED = [
  "public.accept_invitation",
  "public.add_enquiry_note",
  "public.apply_recheck_decision",
  "public.assign_substitution",
  "public.book_ptm_slot",
  "public.cancel_ptm_booking",
  "public.cancel_substitution",
  "public.close_marks_entry",
  "public.convert_enquiry",
  "public.correct_attendance",
  "public.create_institution",
  "public.create_payment_intent",
  "public.decide_application",
  "public.decide_insight",
  "public.decide_leave",
  "public.decide_student_leave",
  "public.decide_studio_request",
  "public.decide_workflow_run",
  "public.enqueue_fee_reminders",
  "public.enqueue_invoice_reminders",
  "public.enqueue_term_invoices",
  "public.enrol_applicant",
  "public.enter_marks",
  "public.exam_verification",
  "public.exit_student",
  "public.generate_invoice",
  "public.generate_seating_plan",
  "public.get_public_site",
  "public.grade_submission",
  "public.invite_member",
  "public.issue_certificate",
  "public.issue_library_loan",
  "public.jobs_requeue",
  "public.link_guardian",
  "public.mark_period_attendance",
  "public.mark_thread_read",
  "public.message_thread_names",
  "public.messageable_teachers",
  "public.my_open_surveys",
  "public.my_upcoming_exam_papers",
  "public.open_marks_entry",
  "public.promote_students",
  "public.propose_studio_request",
  "public.ptm_slots_for_student",
  "public.publish_announcement",
  "public.publish_exam_results",
  "public.publish_page",
  "public.publish_timetable",
  "public.record_audit_event",
  "public.record_insight_action",
  "public.record_payment",
  "public.renew_library_loan",
  "public.reopen_marks_entry",
  "public.request_recheck",
  "public.return_library_loan",
  "public.revoke_invitation",
  "public.send_message",
  "public.set_insight_explanation",
  "public.set_invoice_instalments",
  "public.staff_check_in",
  "public.start_message_thread",
  "public.start_recheck_review",
  "public.start_workflow_run",
  "public.submit_assignment",
  "public.submit_attendance",
  "public.submit_practice_attempt",
  "public.submit_survey_response",
  "public.survey_results",
  "public.void_payment",
];

// M27-T6: public security-invoker, non-trigger functions `authenticated` may
// execute — the RLS-bound aggregates (each still filters under the caller's
// own RLS; no row escapes the normal policy).
export const PUBLIC_INVOKER_AUTHENTICATED = [
  "public.ai_usage_by_provider",
  "public.ai_usage_sum",
  "public.ai_usage_tokens_by_role",
  "public.attendance_daily_counts",
  "public.exam_mark_outliers",
  "public.commit_import_batch",
  "public.finance_collection_report",
  "public.invoice_instalment_status",
  "public.ledger_totals",
  "public.ledger_voucher_lines",
  "public.mastery_heatmap",
  "public.mastery_student_stats",
  "public.report_attendance_daily",
  "public.report_fee_defaulters",
  "public.term_collection_totals",
].sort();

// M27-T6: public non-trigger functions only `service_role` may execute —
// replaces the old 4(+13)-name ad-hoc loop with an exact-set check so a new
// function can't silently join this bucket (or silently leave it).
export const SERVICE_ONLY = [
  "public.apply_late_fees",
  "public.assert_forecast_window",
  "public.compute_mastery",
  "public.compute_mastery_sweep",
  "public.emit_workflow_event",
  "public.enqueue_due_forecasts",
  "public.enqueue_due_late_fees",
  "public.enqueue_due_reports",
  "public.enqueue_due_workflows",
  "public.enqueue_insight_detection",
  "public.enqueue_mastery_compute",
  "public.forecast_attendance_series",
  "public.forecast_fee_series",
  "public.insight_src_admissions",
  "public.insight_src_attendance",
  "public.insight_src_fees",
  "public.insight_src_marks",
  "public.insight_src_room_capacity",
  "public.insight_src_rooms",
  "public.insight_src_submissions",
  "public.insight_src_workload",
  "public.jobs_claim",
  "public.jobs_complete",
  "public.record_insights",
  "public.record_online_payment",
  "public.submit_platform_lead",
  "public.submit_public_enquiry",
  "public.workflow_metric",
].sort();

describe("grants audit (07 §4, T-042 AC3)", () => {
  it("every security definer pins search_path to ''", () => {
    expect(names((r) => r.security === "definer" && r.search_path !== 'search_path=""')).toEqual([]);
  });

  it("anon may execute only public.get_public_site", () => {
    expect(names((r) => !r.is_trigger && r.anon)).toEqual(["public.get_public_site"]);
  });

  it("authenticated may execute only the RLS helpers in app", () => {
    expect(names((r) => r.schema === "app" && !r.is_trigger && r.authenticated)).toEqual(APP_AUTHENTICATED);
  });

  it("app.enqueue_job is not user-callable (lesson 3)", () => {
    expect(names((r) => r.name === "enqueue_job" && (r.anon || r.authenticated))).toEqual([]);
  });

  it("no app function is granted to service_role directly", () => {
    expect(names((r) => r.schema === "app" && !r.is_trigger && r.service_role)).toEqual([]);
  });

  it("authenticated may execute exactly the 07 §4 public RPCs", () => {
    expect(names((r) => r.schema === "public" && r.security === "definer" && r.authenticated)).toEqual(PUBLIC_AUTHENTICATED);
  });

  it("authenticated may execute exactly the declared public invoker functions", () => {
    expect(names((r) => r.schema === "public" && r.security === "invoker" && !r.is_trigger && r.authenticated)).toEqual(
      PUBLIC_INVOKER_AUTHENTICATED,
    );
  });

  it("service_role-only public functions are exactly SERVICE_ONLY", () => {
    expect(
      names((r) => r.schema === "public" && !r.is_trigger && r.service_role && !r.anon && !r.authenticated),
    ).toEqual(SERVICE_ONLY);
  });

  it("every user- or service-callable definer is named in 07 §4", () => {
    const doc = fs.readFileSync(path.join(process.cwd(), "docs/planning/coolskool/07-security-and-ai-governance.md"), "utf8");
    const bare = (qualified: string) => qualified.split(".")[1]!;
    const missing = [...PUBLIC_AUTHENTICATED, ...SERVICE_ONLY].filter((qualified) => !doc.includes(bare(qualified)));
    expect(missing).toEqual([]);
  });

  it("DBT-34: no function casts request.jwt.claims to jsonb without nullif('')", async () => {
    const unsafe = await sql`
      select n.nspname || '.' || p.proname as fn
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('app', 'public')
        and p.prosrc like ${"%current_setting('request.jwt.claims', true)::jsonb%"}
      order by 1
    `;
    expect(unsafe.map((r) => r.fn)).toEqual([]);
  });

  it("fix round 2: every app.* GUC compare outside a plain IF is NULL-safe (coalesce)", async () => {
    // `x = 'on'` is NULL when the GUC was never set on that connection: harmless
    // as an IF condition (NULL -> false), but it poisons a boolean expression
    // (`v_bypass := a or NULL` -> NULL, `not v_bypass` -> NULL). See 0042/0043.
    const fns = await sql<{ fn: string; src: string }[]>`
      select n.nspname || '.' || p.proname as fn, p.prosrc as src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('app', 'public') and p.prosrc like ${"%current_setting('app.%"}
    `;
    const unsafe = fns.flatMap(({ fn, src }) =>
      src
        .split("\n")
        .filter((line) => line.includes("current_setting('app.") && !line.includes("coalesce(current_setting('app."))
        .filter((line) => !/^\s*(if|elsif)\b.*\bthen\s*$/.test(line))
        .map((line) => `${fn}: ${line.trim()}`),
    );
    expect(unsafe).toEqual([]);
  });

  it("service-role-only RPCs are not callable by anon/authenticated", () => {
    // M27-T6: the per-name array is now the SERVICE_ONLY exact-set test
    // above; this keeps the per-row {anon,authenticated,service_role} shape.
    for (const qualified of SERVICE_ONLY) {
      const name = qualified.split(".")[1]!;
      const row = rows.find((r) => r.schema === "public" && r.name === name)!;
      expect({ name, anon: row.anon, authenticated: row.authenticated, service_role: row.service_role }).toEqual({
        name,
        anon: false,
        authenticated: false,
        service_role: true,
      });
    }
  });
});
