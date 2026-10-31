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
  "app.finance_write_roles",
  "app.guardian_student_ids",
  "app.has_role",
  "app.import_insert_guardian_student",
  "app.is_member",
  "app.is_platform_admin",
  "app.lock_import_batch",
  "app.member_institutions",
  "app.my_class_teacher_section_ids",
  "app.my_institution_ids",
  "app.my_student_ids",
  "app.my_student_section_ids",
  "app.my_taught_section_ids",
  "app.my_taught_section_subjects",
  "app.my_taught_student_ids",
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
  "public.close_marks_entry",
  "public.convert_enquiry",
  "public.correct_attendance",
  "public.create_institution",
  "public.decide_application",
  "public.enqueue_term_invoices",
  "public.enrol_applicant",
  "public.enter_marks",
  "public.exam_verification",
  "public.generate_invoice",
  "public.get_public_site",
  "public.invite_member",
  "public.jobs_requeue",
  "public.open_marks_entry",
  "public.publish_exam_results",
  "public.publish_page",
  "public.record_audit_event",
  "public.record_payment",
  "public.reopen_marks_entry",
  "public.request_recheck",
  "public.revoke_invitation",
  "public.start_recheck_review",
  "public.submit_attendance",
];

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
    const serviceOnly = ["jobs_claim", "jobs_complete", "submit_public_enquiry"];
    for (const name of serviceOnly) {
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
