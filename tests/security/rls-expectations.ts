import type { FixtureRole } from "@/../tests/helpers/roles";

export type PolicyClass = "S" | "S+G" | "C" | "T" | "A" | "P" | "O";

export interface TableExpectation {
  classes: PolicyClass[];
  /** Roles that can SELECT this table's rows within their own institution. */
  read: FixtureRole[];
  /** Roles that can INSERT/UPDATE this table's rows within their own institution. */
  write: FixtureRole[];
  /** Class P only (T-023): true if `anon` has a SELECT policy (published/live rows only). */
  anonRead?: boolean;
  /**
   * Columns the generated suite should SELECT instead of "*", for a table
   * with column-level grants (a column excluded from the table-wide grant
   * makes `select("*")` 42501 at the grant layer, before RLS runs).
   */
  selectColumns?: string[];
  /**
   * M27-T4: a DBT id (e.g. "DBT-45") when a plain cross-institution INSERT
   * on this table fails for a reason other than 42501 / coded P0001 — the
   * generated suite's INSERT probe still requires an error, just not that
   * specific shape, and the id documents why.
   */
  insertProbeException?: string;
}

// 05 §5 — the seven tables migration 0002 (T-004) creates. Later migrations'
// packets add a row here for each tenant table they create (07 §6 C-01: the
// generated suite fails if any table with an `institution_id` column lacks
// an entry).
export const RLS_EXPECTATIONS: Record<string, TableExpectation> = {
  institutions: {
    classes: ["A"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin"],
  },
  campuses: {
    classes: ["S"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher"],
    write: ["owner", "principal", "admin"],
  },
  academic_years: {
    classes: ["S"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher"],
    write: ["owner", "principal", "admin"],
  },
  terms: {
    classes: ["S"],
    // 20261028000051: a second permissive policy (terms_select_member)
    // grants any institution member SELECT (dates aren't sensitive) —
    // widens the staff-only 0003 policy to guardian/student too.
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "guardian", "student"],
    write: ["owner", "principal", "admin"],
  },
  memberships: {
    classes: ["O"],
    // memberships_select (0002): own row (any role) OR owner/principal/admin
    // read all — class O's self-row scope, same shape as `profiles` below.
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin"],
  },
  institution_sequences: {
    classes: ["A"],
    read: [],
    write: [],
  },
  // No institution_id (global, keyed by auth.users.id) — exempt from the
  // cross-tenant portion of the generated suite; kept here as the 7th
  // documented core-table entry (class O: own row, 0002).
  profiles: {
    classes: ["O"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
  },

  // 0003 (T-005) tables — added here because this file (T-009) didn't exist
  // when that migration landed; closing the gap now rather than leaving the
  // generated suite failing against the current schema.
  audit_events: {
    classes: ["A"],
    read: ["owner", "principal", "admin"],
    write: [], // writes only via app.audit (security definer)
  },
  jobs: {
    classes: ["A"],
    read: ["owner", "principal", "admin"],
    // M27-T4 fix: entry said "UPDATE (requeue) only", stale since 0012
    // dropped jobs_update (HIGH fix — let any role escalate a job) in favour
    // of public.jobs_requeue (security definer). No table write policy at
    // all today — writes only via jobs_requeue/jobs_claim/jobs_complete.
    write: [],
  },
  // Row-scoped (recipient_user_id = current user), not role-scoped — every
  // role can read/update(read_at) only their own rows. Listed here for
  // documentation; the generated suite's same-institution check doesn't
  // apply to class O tables.
  notifications: {
    classes: ["O"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
  },
  delivery_attempts: {
    classes: ["C"],
    read: ["owner", "principal", "admin", "admissions"],
    write: [],
  },
  ai_usage_events: {
    classes: ["A"],
    read: ["owner", "principal", "admin"],
    write: [],
  },

  // 0004 (T-010) — people.
  departments: {
    classes: ["S"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher"],
    write: ["owner", "principal", "admin"],
  },
  staff: {
    classes: ["S+G"],
    read: ["owner", "principal", "admin", "accountant", "exam_controller"], // + own row (user_id match)
    write: ["owner", "principal", "admin"],
  },
  students: {
    classes: ["S+G"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"], // teacher: active enrolment in a taught section (DBT-17, 0025)
    write: ["owner", "principal", "admin", "admissions"],
  },
  guardians: {
    classes: ["S+G"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "teacher", "guardian"], // teacher/guardian scoped
    write: ["owner", "principal", "admin", "admissions"],
  },
  guardian_students: {
    classes: ["S+G"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "teacher", "guardian"], // 07 §2.2 guardian.read (no exam_controller, no student — 0040); teacher: students in a taught section (DBT-17, 0025); guardian: own links
    write: ["owner", "principal", "admin", "admissions"],
    // M27-T4: a plain cross-institution INSERT recurses (42P17) instead of
    // 42501 — DBT-45 (guardian_students_insert check → guardians_select
    // teacher branch subquery → guardian_students policy). Still rejected,
    // just not in the coded shape the generic probe otherwise requires.
    insertProbeException: "DBT-45",
  },

  // 0005 (T-011) — academics.
  grades: {
    classes: ["S"],
    // Institution-wide reference data (the class ladder) — every member reads.
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin"],
  },
  subjects: {
    classes: ["S"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin"],
  },
  class_sections: {
    classes: ["S+G"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin"],
  },
  subject_assignments: {
    classes: ["S+G"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin"],
  },
  enrolments: {
    classes: ["S+G"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"], // teacher: taught sections only (DBT-17, 0025)
    write: ["owner", "principal", "admin", "admissions"],
  },
  enrolment_status_history: {
    classes: ["A"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"], // teacher: taught sections only (DBT-17, 0025)
    write: [], // trigger-only
  },
  curriculum_units: {
    classes: ["S+G"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin"],
  },
  assignments: {
    classes: ["S+G", "T"],
    read: ["owner", "principal", "admin", "teacher", "student", "guardian"], // 07 §2.2 assignment.read (DBT-17, 0025): teacher taught sections; student/guardian published, own sections
    write: ["owner", "principal", "teacher"], // teacher: class teacher of the section (any subject) or subject teacher of exactly that subject (DBT-19, 0026)
  },
  assignment_submissions: {
    classes: ["O", "T"],
    read: ["owner", "principal", "admin", "teacher", "student", "guardian"], // teacher scoped to their sections (M09)
    write: [], // self-grading hole closed (M09): writes only via submit_assignment/grade_submission RPCs, no INSERT/UPDATE policy
  },
  // T-036 phase 2 / DBT-21 (20261028000023) — answers/explanations moved out
  // of assignments.content into this staff-only table; scoped to
  // assignment.manage, narrower than assignments' own section-level
  // app.teaches_section (uses app.my_taught_section_subjects, subject-level,
  // DBT-19 lesson). No admin/exam_controller, no guardian/student.
  assignment_answer_keys: {
    classes: ["C"],
    read: ["owner", "principal", "teacher"], // teacher: the assignment section's class teacher, or the subject they teach in that section (0023, 0034)
    write: ["owner", "principal", "teacher"], // same scope
  },

  // 0006 (T-014) — attendance. 07 §2.2 attendance.read: owner/principal/
  // admin/exam_controller full; teacher only sections they teach; student/
  // guardian own-scope; admissions/accountant none (no longer staff_roles()
  // blanket read — HIGH finding, security review). The generated suite
  // (rls-generated.test.ts) only proves cross-institution isolation per
  // role, not within-institution section scoping — "teacher" below means
  // scoped via app.teaches_section, not every section; that narrower claim
  // is covered by explicit db tests in tests/db/attendance-schema.test.ts,
  // not by this list.
  attendance_sessions: {
    classes: ["S+G", "T"],
    read: ["owner", "principal", "admin", "exam_controller", "teacher", "student", "guardian"], // teacher scoped to sections they teach
    // T-015 (0014): direct UPDATE is blocked once a session is `submitted`
    // (can never set or leave that status directly) — status only changes
    // through public.submit_attendance. "write" below is still accurate for
    // an `open` session.
    write: ["owner", "principal", "admin", "teacher"], // teacher scoped to sections they teach; INSERT/UPDATE also require the student to be enrolled in that section
  },
  attendance_records: {
    classes: ["S+G", "T"],
    read: ["owner", "principal", "admin", "exam_controller", "teacher", "student", "guardian"], // teacher scoped via the record's session's section
    // T-015 (0014): direct INSERT/UPDATE is additionally gated on the
    // record's session being `open` — a submitted session's records change
    // only through public.correct_attendance.
    write: ["owner", "principal", "admin", "teacher"], // teacher scoped via the record's session's section; student_id must be enrolled in that section (CRITICAL fix, security review)
  },
  attendance_corrections: {
    classes: ["S+G", "T"],
    read: ["owner", "principal", "admin", "exam_controller", "teacher", "student", "guardian"], // teacher scoped via the corrected record's session's section
    // T-015 (0014): the direct INSERT policy was dropped with no
    // replacement — a correction can only be written by public.
    // correct_attendance (security definer, bypasses RLS as table owner),
    // which enforces the correction window and writes the audit row that a
    // bare INSERT skipped.
    write: [],
  },

  // 0007 (T-026) — admissions. 07 §2.2 `admissions.enquiry.read/write` and
  // `admissions.enrol` grant own/principal/admin/admissions (narrower than
  // app.staff_roles() — accountant/exam_controller/teacher excluded). FK
  // scope checks (grade_applied_id, assigned_to, enquiry_id, academic_year_id)
  // live in the `with check` clauses, not here.
  enquiries: {
    classes: ["S"],
    read: ["owner", "principal", "admin", "admissions"],
    write: ["owner", "principal", "admin", "admissions"],
  },
  applications: {
    classes: ["S"],
    read: ["owner", "principal", "admin", "admissions"],
    write: ["owner", "principal", "admin", "admissions"],
  },
  // DEVIATION from the packet's uniform role set on INSERT only: 07 §2.2
  // `admissions.application.decide` grants own/principal/admissions, NOT
  // admin (unlike enquiry.read/write and enrol, where admin is listed) —
  // followed per the lead's standing instruction to match the matrix over
  // a coarse packet-stated RLS class. SELECT keeps admin (no separate
  // "decisions.read" row exists); no UPDATE policy (append-only).
  application_decisions: {
    classes: ["S", "A"],
    read: ["owner", "principal", "admin", "admissions"],
    write: ["owner", "principal", "admissions"], // INSERT-only, admin excluded (see above)
  },

  // 0010 (T-023) — website. Class P: every member SELECTs every row of
  // their institution (including drafts — the internal editor needs them);
  // `website.edit` (07 §2.2) grants INSERT/UPDATE to owner/principal/admin/
  // admissions. `website.publish` (owner/principal/admin, admissions
  // excluded) is enforced inside app.publish_page, not by a table policy,
  // so it has no `write` entry here. `anonRead: true` tables additionally
  // expose a published/live-only anon SELECT policy (T5, C-80) — never a
  // draft, proven explicitly in tests/db/website-schema.test.ts, not by the
  // generated suite's authenticated-only ROLES loop.
  websites: {
    classes: ["P"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin", "admissions"], // is_live only owner/principal/admin — website.publish trigger (DBT-28, 0028)
    anonRead: true,
  },
  pages: {
    classes: ["P"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin", "admissions"],
    anonRead: true,
  },
  page_versions: {
    classes: ["P"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin", "admissions"], // INSERT-only; UPDATE/DELETE blocked outside app.publish_page
    anonRead: true,
  },
  notices: {
    classes: ["P"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin", "admissions"],
    anonRead: true,
  },
  events: {
    classes: ["P"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin", "admissions"],
    anonRead: true,
  },

  // 0008 (T-030) — finance. Class C: app.finance_roles() = owner/principal/
  // admin/accountant (07 §2.2 finance.* rows all grant exactly this set).
  // fee_structures/fee_components/fee_assignments/concessions are
  // finance_roles()-only config tables with direct writes (FK-scoped `with
  // check`, lead instruction). invoices/invoice_lines/payments/receipts add
  // guardian/student own-scope SELECT (05 §5's stated list); ledger_entries
  // does not (not in that list). invoices/invoice_lines/payments/receipts/
  // ledger_entries have NO insert/update policy at all — written only by
  // app.generate_invoice/app.record_payment (security definer, bypass RLS
  // as the function owner), same shape as audit_events/jobs.
  // 0019 (T-028, lead ruling) — fee_structures_select widened to also let
  // "admissions" read (07 §2.2 admissions.enrol needs to pick a fee
  // structure; writes stay finance_roles()-only, unchanged).
  fee_structures: {
    classes: ["C"],
    read: ["owner", "principal", "admin", "accountant", "admissions"],
    write: ["owner", "principal", "admin", "accountant"],
  },
  fee_components: {
    classes: ["C"],
    read: ["owner", "principal", "admin", "accountant"],
    write: ["owner", "principal", "admin", "accountant"],
  },
  fee_assignments: {
    classes: ["C"],
    read: ["owner", "principal", "admin", "accountant"],
    write: ["owner", "principal", "admin", "accountant"],
  },
  concessions: {
    classes: ["C"],
    read: ["owner", "principal", "admin", "accountant"],
    write: ["owner", "principal", "admin", "accountant"],
  },
  invoices: {
    classes: ["C"],
    read: ["owner", "principal", "admin", "accountant", "student", "guardian"], // student/guardian scoped to own
    write: [], // app.generate_invoice / app.record_payment only
  },
  invoice_lines: {
    classes: ["C"],
    read: ["owner", "principal", "admin", "accountant", "student", "guardian"], // scoped via the line's invoice
    write: [], // app.generate_invoice only; immutable (block_mutation)
  },
  payments: {
    classes: ["C"],
    read: ["owner", "principal", "admin", "accountant", "student", "guardian"], // scoped via the payment's invoice
    write: [], // app.record_payment only; immutable (block_mutation)
  },
  receipts: {
    classes: ["C"],
    read: ["owner", "principal", "admin", "accountant", "student", "guardian"], // scoped via the receipt's payment's invoice
    write: [], // app.record_payment only; immutable (block_mutation)
  },
  ledger_entries: {
    classes: ["C"],
    read: ["owner", "principal", "admin", "accountant"], // not guardian/student-visible
    write: [], // app.generate_invoice / app.record_payment only; immutable (block_mutation)
  },

  // 20261028000074 (M12-T4) — finance_plus.
  payment_reversals: {
    classes: ["C"],
    read: ["owner", "principal", "admin", "accountant", "student", "guardian"], // scoped via the reversal's invoice
    write: [], // app.void_payment only; immutable (block_mutation)
  },
  fee_reminders: {
    classes: ["C"],
    read: ["owner", "principal", "admin", "accountant"], // not guardian/student-visible
    write: [], // finance.fee_reminder job handler (service role) only
  },

  // 20261028000083 (M12-T5) — online_payments.
  online_payment_intents: {
    classes: ["C"],
    read: ["owner", "principal", "admin", "accountant", "student", "guardian"], // scoped via the intent's invoice
    write: [], // public.create_payment_intent / public.record_online_payment only; no UPDATE/DELETE policy at all
  },

  // 0009 (T-017) — exams. app.exam_write_roles() (owner/principal/
  // exam_controller) is narrower than app.exam_roles() (0001, +admin) —
  // 07 §2.2 exam.manage/exam.result.publish/exam.recheck.review+decide all
  // exclude admin (lesson #1); exam.result.read is the one row that keeps
  // admin, matching app.exam_roles() exactly. "write" below reflects the
  // generated suite's same-institution check only — teacher/guardian/
  // student scoping (subject-level for marks, own-section for results,
  // own-child for recheck_requests) is proved by tests/db/exams-schema.test.ts.
  exams: {
    classes: ["S"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"], // student/guardian: published exams their own/linked students have results in (T-042, 0030)
    write: ["owner", "principal", "exam_controller"], // admin excluded (exam.manage)
  },
  exam_papers: {
    classes: ["S"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher"],
    write: ["owner", "principal", "exam_controller"], // admin excluded (exam.manage)
  },
  marks: {
    classes: ["C", "T"],
    read: ["owner", "principal", "exam_controller", "teacher"], // teacher scoped to paper's section+subject; no admin, no guardian/student
    write: ["owner", "principal", "exam_controller", "teacher"], // teacher scoped to paper's section+subject
  },
  results: {
    classes: ["C", "S+G"],
    read: ["owner", "principal", "admin", "exam_controller", "teacher", "student", "guardian"], // teacher scoped to the student's current section; student/guardian own-scope
    write: [], // app.publish_exam_results / app.apply_recheck_decision only
  },
  recheck_requests: {
    classes: ["C", "O"],
    read: ["owner", "principal", "exam_controller", "student", "guardian"], // student/guardian own-scope via the result they requested against
    write: [], // T-020 Batch B (20261028000022): no direct INSERT policy any more — app.request_recheck only, which enforces the window/reason/one-open-request rules a bare policy couldn't
  },
  recheck_decisions: {
    classes: ["C"],
    read: ["owner", "principal", "admin", "exam_controller"],
    write: [], // app.apply_recheck_decision only; append-only (block_mutation)
  },
  answer_sheets: {
    classes: ["C"],
    read: ["owner", "principal", "admin", "exam_controller"],
    write: ["owner", "principal", "admin", "exam_controller"],
  },

  // 0047 (T-0NN) — result_remarks. Mutable (rule 5 does not apply —
  // editorial commentary, not a mark). SELECT mirrors results_select
  // exactly (admin included, same as `results` above); write mirrors
  // app.exam_write_roles() (admin excluded, lesson #1) plus the result's
  // taught teacher, scoped the same way marks' teacher branch is.
  result_remarks: {
    classes: ["C", "T", "S+G"],
    read: ["owner", "principal", "admin", "exam_controller", "teacher", "student", "guardian"], // teacher/student/guardian own-scope via the result
    write: ["owner", "principal", "exam_controller", "teacher"], // teacher scoped to a student they teach; no admin
  },

  // 0049 (GU-07, D32) — student study notebook. Own-rows-only for every
  // role (same shape as `notifications`) — RLS itself grants any member
  // the same own-row access regardless of role (database-reviewer, L6:
  // this table does NOT enforce "student only" at the RLS layer). Only
  // `student` is listed here because D32 scopes the feature to students
  // at the application layer (`ai.study` permission, student only,
  // GU-08) — no other role is expected to ever call the action that
  // creates a row, not because RLS would stop them if they somehow did.
  study_items: {
    classes: ["O"],
    read: ["student"],
    write: ["student"],
  },
  study_preferences: {
    classes: ["O"],
    read: ["student"],
    write: ["student"],
  },
  // 0135 — per-user home dashboard layout. Own row only, every role holds
  // dashboard.view; the generic suite checks cross-institution isolation.
  dashboard_preferences: {
    classes: ["O"],
    read: ["owner", "principal", "admin", "teacher", "accountant", "admissions", "exam_controller", "student", "guardian"],
    write: ["owner", "principal", "admin", "teacher", "accountant", "admissions", "exam_controller", "student", "guardian"],
  },

  // M03-T1 (20261028000064) — invitations. Narrower than campuses/academic_years
  // (class S's usual staff_roles() read): only owner/principal/admin, matching
  // member.manage (07 §2.2). No write entry — every row comes from the
  // invite_member/accept_invitation/revoke_invitation RPCs (M03-T2), not a
  // table policy (function-only, same shape as institution_sequences).
  invitations: {
    classes: ["S"],
    read: ["owner", "principal", "admin"],
    write: [],
    selectColumns: ["id", "institution_id", "email", "role"],
  },

  // M04-T2 (20261028000066) — CSV import. Same narrow read/write set as
  // invitations: `data.import` (M04-T1) is owner/principal/admin only, no
  // admissions even though students/guardians/enrolments INSERT lets
  // admissions write those tables directly — commit_import_batch (M04-T3)
  // checks this same role set before it writes anything.
  import_batches: {
    classes: ["S"],
    read: ["owner", "principal", "admin"],
    write: ["owner", "principal", "admin"],
  },
  import_rows: {
    classes: ["S"],
    read: ["owner", "principal", "admin"],
    write: ["owner", "principal", "admin"],
  },

  // M05-T2 (20261028000067) — documents. Not a uniform per-institution read:
  // owner/principal/admin see every row; admissions only student/application
  // rows; teacher/accountant/exam_controller/guardian/student see only rows
  // scoped to themselves (own staff doc, or own/linked-child's student doc) —
  // explicit scoping is proved in tests/db/documents-rls.test.ts, not by the
  // generated suite's own-institution assumption. Listed roles below are
  // exactly those with document.read (07 §2.2); admissions/accountant/
  // exam_controller/teacher/student/guardian all read 0 rows in the
  // generated suite's plain cross-institution probe since it inserts no
  // entity_id/staff ownership scoping, which is expected and does not
  // contradict their real (scoped) read access.
  documents: {
    classes: ["S", "O"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin", "admissions"],
  },

  // 0068 (M06-T2) — managers-only; recipients never read these tables
  // (they get a `notifications` row instead, fanned out by M06-T3's
  // notify.announcement job handler). Explicit scoping proved in
  // tests/db/announcements-rls.test.ts.
  announcements: {
    classes: ["A"],
    read: ["owner", "principal", "admin"],
    write: ["owner", "principal", "admin"],
  },
  announcement_audiences: {
    classes: ["A"],
    read: ["owner", "principal", "admin"],
    write: ["owner", "principal", "admin"], // INSERT/UPDATE only while the parent announcement is still a draft
  },
  // Row-scoped (user_id = current user, same shape as `notifications`) —
  // every role can read/write only their own preference rows.
  notification_preferences: {
    classes: ["O"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
  },

  // 0069 (M07-T2) — rooms/periods: every active member reads (bell schedule
  // is not sensitive); owner/principal/admin write.
  rooms: {
    classes: ["A"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin"],
  },
  periods: {
    classes: ["A"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin"],
  },
  // timetable_versions/timetable_slots: owner/principal/admin see every
  // version/slot (draft, published, archived); every other role sees
  // published only, and guardian/student additionally only their own
  // child's/own current section's slots — explicit scoping proved in
  // tests/db/timetable-rls.test.ts, not by the generated suite's plain
  // own-institution probe.
  timetable_versions: {
    classes: ["S+G"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin"],
  },
  timetable_slots: {
    classes: ["S+G"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin"],
  },

  // 0072 (M10-T1) — lesson_plans: owner/principal/admin see every plan;
  // teacher scoped to write-scope W (class teacher or taught section+
  // subject); no guardian/student, accountant, admissions, exam_controller
  // — explicit scoping proved in tests/db/curriculum-rls.test.ts, not by
  // the generated suite's plain own-institution probe.
  lesson_plans: {
    classes: ["C", "T"],
    read: ["owner", "principal", "admin", "teacher"],
    write: ["owner", "principal", "teacher"],
  },
  // curriculum_unit_coverage: all staff roles read (same shape as 0020's
  // subject_assignments_select), plus guardian/student via their own/
  // linked child's current section; write is the same W as lesson_plans.
  curriculum_unit_coverage: {
    classes: ["S+G", "T"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "teacher"],
  },

  // 0070 part 1 (M08-T2) — staff_attendance/leave_requests: owner/principal/
  // admin see every row of the institution; every other staff role sees
  // only its own staff_id's rows via app.my_staff_ids(); guardian/student
  // have no staff_id and see none — explicit own-row scoping proved in
  // tests/db/staff-leave-rls.test.ts, not by the generated suite's plain
  // own-institution probe.
  staff_attendance: {
    classes: ["O"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher"],
    write: ["owner", "principal", "admin"],
  },
  leave_requests: {
    classes: ["O"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher"],
    write: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher"],
  },
  // 0070 part 2 (M08-T3) — substitutions: owner/principal/admin see every
  // row; every other staff role sees only rows where its own staff_id is
  // substitute_teacher_id or original_teacher_id via app.my_staff_ids();
  // own-row scoping proved in tests/db/substitutions-rls.test.ts, not by
  // the generated suite's plain own-institution probe. No write policy at
  // all: writes are assign_substitution/cancel_substitution only.
  substitutions: {
    classes: ["O"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher"],
    write: [],
  },

  // 0075 (M13-T2) — operations: facilities, transport, calendar. Explicit
  // row/stop/route scoping (guardian/student own assignment only, teacher
  // own-raised-only on maintenance_requests) proved in
  // tests/db/operations-rls.test.ts, not by the generated suite's plain
  // own-institution probe.
  assets: {
    classes: ["S"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher"],
    write: ["owner", "principal", "admin"],
  },
  // owner/principal/admin read every request; every other staff role
  // (maintenance.request holder) reads only requests they raised
  // (raised_by = caller) — row-owner scoped, same ["S","O"] shape as
  // documents.
  maintenance_requests: {
    classes: ["S", "O"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher"],
    write: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher"], // INSERT (raise) by all 7; UPDATE (assign/close) owner/principal/admin only
  },
  transport_vehicles: {
    classes: ["S+G"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"], // student/guardian scoped to their own assignment's route's vehicle
    write: ["owner", "principal", "admin"],
  },
  transport_routes: {
    classes: ["S+G"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"], // student/guardian scoped to their own assignment's route
    write: ["owner", "principal", "admin"],
  },
  transport_stops: {
    classes: ["S+G"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"], // student/guardian: own stop only, never the route's other stops
    write: ["owner", "principal", "admin"],
  },
  transport_assignments: {
    classes: ["S+G", "T"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"], // teacher: taught students only (app.my_taught_student_ids); student/guardian: own/linked student only
    write: ["owner", "principal", "admin"],
  },
  academic_calendar_events: {
    classes: ["S+G"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"], // student/guardian: audience 'all' only
    write: ["owner", "principal", "admin"],
  },
  student_lifecycle_events: {
    classes: ["S+G"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"], // teacher: taught students only (DBT-17 shape, app.my_taught_student_ids); student/guardian: own/linked student only
    write: [], // rows come only from the 0076 SECURITY DEFINER functions (T3-T5)
  },
  // 0073 (M11-T2) — question_bank: staff-only, no admin (not in 07 §2.2's
  // question.manage row). teacher scoped to the (grade, subject) pairs
  // they teach (app.my_taught_section_subjects() joined to class_sections
  // for grade_id); owner/principal/exam_controller institution-wide.
  question_bank: {
    classes: ["C"],
    read: ["owner", "principal", "exam_controller", "teacher"],
    write: ["owner", "principal", "exam_controller", "teacher"],
  },

  // 0095 (M22-T2) — agent_definitions/agent_runs: owner/principal/admin
  // read every row of the institution (same shape as audit_events/jobs).
  // agent_definitions write is UPDATE of `is_enabled` only, owner/principal
  // (admin excluded — tests/db/agents-rls.test.ts); 0134 adds INSERT of
  // custom-agent rows and UPDATE of their custom columns, same
  // owner/principal (tests/db/custom-agents.test.ts); agent_runs has no
  // authenticated write at all, every write is server-only after the
  // calling action's own permission check (rulings "Writes are
  // server-only").
  agent_definitions: {
    classes: ["A"],
    read: ["owner", "principal", "admin"],
    write: ["owner", "principal"],
  },
  agent_runs: {
    classes: ["A"],
    read: ["owner", "principal", "admin"],
    write: [], // server-only (service-role caller `agents`, T7)
  },
  // 0077 (M15-T3) — scheduled_reports: report.schedule is owner/principal/
  // admin only (07 §2.2); no DELETE policy (pause instead of delete).
  scheduled_reports: {
    classes: ["A"],
    read: ["owner", "principal", "admin"],
    write: ["owner", "principal", "admin"],
  },
  // 0096 (M23-T2) — workflows: owner/principal/admin read every row;
  // insert/update owner/principal only (admin can never author, matching
  // 07 §2.2 workflow.manage); no DELETE policy (disable instead).
  workflows: {
    classes: ["A"],
    read: ["owner", "principal", "admin"],
    write: ["owner", "principal"],
  },
  // workflow_runs: owner/principal/admin read every row; every write is
  // server-only (definers + service role, rulings "Run lifecycle").
  workflow_runs: {
    classes: ["A"],
    read: ["owner", "principal", "admin"],
    write: [],
  },
  // 0086 (X03-T2) — library_books/library_copies: every active member
  // reads (titles aren't sensitive); owner/principal/admin write.
  library_books: {
    classes: ["S"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin"],
  },
  library_copies: {
    classes: ["S"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin"],
  },
  // library_loans: owner/principal/admin see every row; other staff roles
  // see only rows where its own staff_id is the borrower (app.my_staff_ids);
  // student/guardian see own/linked student's loans only — explicit own-row
  // scoping proved in tests/db/library-rls.test.ts, not by the generated
  // suite's plain own-institution probe. No write policy: issue/renew/return
  // RPCs only.
  library_loans: {
    classes: ["O"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: [],
  },

  // 20261028000087 (X04-T2) — fee_plans: late fees + instalment plans.
  late_fee_rules: {
    classes: ["C"],
    read: ["owner", "principal", "admin", "accountant"],
    write: ["owner", "principal", "accountant"], // app.finance_write_roles() — admin excluded
  },
  invoice_instalments: {
    classes: ["C"],
    read: ["owner", "principal", "admin", "accountant", "student", "guardian"], // scoped via the instalment's invoice
    write: [], // public.set_invoice_instalments only; no direct write policy
  },
  late_fee_charges: {
    classes: ["C"],
    read: ["owner", "principal", "admin", "accountant", "student", "guardian"], // scoped via the charge's invoice
    write: [], // app.apply_late_fees (X04-T4) only; immutable (block_mutation)
  },
  // 0091 (X02-T2) — certificates: staff-only (certificate.manage role set),
  // narrower than student_lifecycle_events (no teacher/student/guardian —
  // they hold the paper copy). No write policy: rows come only from T3's
  // app.issue_certificate (SECURITY DEFINER).
  certificates: {
    classes: ["S"],
    read: ["owner", "principal", "admin", "admissions"],
    write: [],
  },

  // 0088 (X06-T2) — exam seating. Headers (exam_seating_plans) hold no
  // student data, so guardian/student see every current header institution-
  // wide; exam_seats additionally scopes guardian/student to their own
  // child's/own seat in a current plan only — explicit own-row/version
  // scoping proved in tests/db/exam-seating-rls.test.ts, not by the
  // generated suite's plain own-institution probe. No write policy on
  // either table: rows come only from T3's app.generate_seating_plan.
  exam_seating_plans: {
    classes: ["C"],
    read: ["owner", "principal", "admin", "exam_controller", "student", "guardian"],
    write: [],
  },
  exam_seats: {
    classes: ["C", "S+G"],
    read: ["owner", "principal", "admin", "exam_controller", "student", "guardian"], // student/guardian: own seat in the current plan only
    write: [],
  },
  // 0092 (M19-T2) — insights: owner/principal/admin read every domain;
  // admissions/accountant/exam_controller read only their matching domain;
  // teacher reads attendance/academics rows of taught sections only.
  // Writes only via record_insights (service role, T2) and the T3 definers.
  insights: {
    classes: ["S", "T"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher"],
    write: [],
  },
  insight_actions: {
    classes: ["C"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher"], // inherits the parent insight's visibility
    // append-only via record_insight_action (T3 definer); 0093 (M20) adds a
    // permissive UPDATE on kind = 'intervention' rows for owner/principal/class teacher.
    write: ["owner", "principal", "teacher"],
  },
  briefings: {
    classes: ["S"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher"], // non-admin-tier roles see only role = their own role
    write: [], // M25 writes it (service role)
  },
  // 0094 (M21-T2) — forecasts/forecast_backtests: no write policy at all,
  // written only by the forecast.run job (service role, bypasses RLS).
  // SELECT splits by row kind: fee_collections_term to finance_roles();
  // attendance_rate_week to owner/principal/admin/exam_controller
  // institution-wide, plus teacher scoped to app.my_taught_section_ids()
  // (never attendance:school, never fees) — explicit per-role scoping
  // proved in tests/db/forecasts-rls.test.ts, not by the generated suite's
  // plain own-institution probe.
  forecast_backtests: {
    classes: ["C", "T"],
    read: ["owner", "principal", "admin", "accountant", "exam_controller", "teacher"],
    write: [],
  },
  forecasts: {
    classes: ["C", "T"],
    read: ["owner", "principal", "admin", "accountant", "exam_controller", "teacher"],
    write: [],
  },
  // 0090 (X07-T2) — visitors module (default off). visitor_entries:
  // owner/principal/admin only, class S. No column-level grants.
  visitor_entries: {
    classes: ["S"],
    read: ["owner", "principal", "admin"],
    write: ["owner", "principal", "admin"],
  },
  // pickup_persons: owner/principal/admin, plus class teacher of the
  // student's section (read-only), plus the linked guardian (read/write
  // their own child's rows, no update — remove + add).
  pickup_persons: {
    // 0090 security review MED-1: raw `phone` is column-revoked; select the granted columns.
    selectColumns: ["id", "institution_id", "student_id", "full_name", "relation", "phone_masked"],
    classes: ["S", "T", "O"],
    read: ["owner", "principal", "admin", "teacher", "guardian"],
    write: ["owner", "principal", "admin", "guardian"],
  },
  // gate_passes: owner/principal/admin, plus the class teacher of the
  // student's section (read/create/decide own-section passes only — DBT-45
  // collector validation in app.gate_pass_before_insert). No delete;
  // guardians/students get a notification row, never read access here.
  gate_passes: {
    classes: ["S", "T"],
    read: ["owner", "principal", "admin", "teacher"],
    write: ["owner", "principal", "admin", "teacher"],
  },

  // 0085 part 1 (X01-T4) — student_leave_requests: owner/principal/admin
  // see every row of the institution; a teacher sees only rows for
  // sections they are the class teacher of (app.my_class_teacher_section_ids);
  // guardian/student see their own/linked children's rows
  // (app.my_student_ids); admissions/accountant/exam_controller see none.
  // Explicit section/own-child scoping proved in
  // tests/db/student-leave-rls.test.ts, not by the generated suite's plain
  // own-institution probe. No UPDATE/DELETE policy: writes are
  // decide_student_leave only (teacher-write here reflects INSERT by a
  // guardian only — "write" is kept for the generated suite's shape, scoped
  // by the explicit db test instead).
  student_leave_requests: {
    classes: ["S+G", "T", "O"],
    read: ["owner", "principal", "admin", "teacher", "student", "guardian"],
    write: ["guardian"], // INSERT only (own children); decisions via decide_student_leave
  },

  // 0085 part 2 (X01-T5) — diary_entries: owner/principal/admin see every
  // row of the institution; a teacher sees rows for sections they teach
  // (app.my_taught_section_ids, class or subject teacher); guardian/student
  // see rows for their own/linked children's sections
  // (app.my_student_section_ids); admissions/accountant/exam_controller see
  // none. INSERT is admin or a taught-section teacher only; DELETE is the
  // author or admin; no UPDATE policy (delete + repost). Explicit scoping
  // (another section's teacher, spoofed created_by) proved in
  // tests/db/diary-rls.test.ts, not by the generated suite's plain
  // own-institution probe.
  diary_entries: {
    classes: ["S+G", "T", "O"],
    read: ["owner", "principal", "admin", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin", "teacher"], // INSERT (taught sections) + DELETE (author/admin)
  },

  // 0085 part 2 (X01-T5) — diary_acknowledgements: owner/principal/admin
  // see every row; a teacher sees acks for entries of sections they teach
  // (exists join on diary_entries.class_section_id = any(my_taught_section_ids));
  // guardian/student see their own/linked children's acks
  // (app.my_student_ids); admissions/accountant/exam_controller see none.
  // INSERT is guardian only, scoped to their own child, an entry in the
  // same institution with requires_ack, and active enrolment in the
  // entry's section — proved explicitly in tests/db/diary-rls.test.ts, not
  // by the generated suite's plain own-institution probe. No UPDATE/DELETE
  // policy.
  diary_acknowledgements: {
    classes: ["S+G", "T", "O"],
    read: ["owner", "principal", "admin", "teacher", "student", "guardian"],
    write: ["guardian"], // INSERT only (own children, requires_ack entries)
  },

  // 0099 part A (X08-T2) — ptm_events/ptm_event_sections/ptm_slots:
  // staff-only read (7 staff roles via app.my_institution_ids). Guardians
  // and students never read these directly; they use
  // public.ptm_slots_for_student instead. ptm_slots write is owner/
  // principal/admin for any staff, or a teacher for their own staff_id
  // scoped to an event section they teach (explicit scoping proved in
  // tests/db/ptm-rls.test.ts, not by the generated suite's plain
  // own-institution probe).
  ptm_events: {
    classes: ["C"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher"],
    write: ["owner", "principal", "admin"],
  },
  ptm_event_sections: {
    classes: ["C"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher"],
    write: ["owner", "principal", "admin"],
  },
  ptm_slots: {
    classes: ["C", "T"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher"],
    write: ["owner", "principal", "admin", "teacher"], // teacher: own staff_id + a section they teach only
  },
  // ptm_bookings: no INSERT/UPDATE/DELETE policy at all — writes only via
  // book_ptm_slot/cancel_ptm_booking. Read is owner/principal/admin all;
  // teacher own slots (app.my_staff_ids); guardian/student own/linked
  // child (app.my_student_ids) — scoping proved in tests/db/ptm-rls.test.ts.
  ptm_bookings: {
    classes: ["S+G", "T", "O"],
    read: ["owner", "principal", "admin", "teacher", "student", "guardian"],
    write: [],
  },

  // 0099 part B (X08-T3) — surveys/survey_audiences: admin-only, same shape
  // as announcements/announcement_audiences (0068). Recipients never read
  // these tables directly; they get public.my_open_surveys instead.
  surveys: {
    classes: ["A"],
    read: ["owner", "principal", "admin"],
    write: ["owner", "principal", "admin"],
  },
  survey_audiences: {
    classes: ["A"],
    read: ["owner", "principal", "admin"],
    write: ["owner", "principal", "admin"], // INSERT/UPDATE only while the parent survey is still draft
  },
  // survey_respondents: row-scoped (user_id = current user, same shape as
  // notification_preferences) — writes only via submit_survey_response
  // (SECURITY DEFINER), never direct PostgREST INSERT.
  survey_respondents: {
    classes: ["O"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: [],
  },
  // survey_responses: no INSERT/UPDATE/DELETE policy at all — writes only
  // via submit_survey_response. SELECT is owner/principal/admin AND only
  // non-anonymous rows (respondent_user_id is not null); an anonymous
  // survey's responses are never selectable at all, even by admins —
  // scoping proved in tests/db/surveys-rls.test.ts, not the generated
  // suite's plain own-institution probe.
  survey_responses: {
    classes: ["A", "O"],
    read: ["owner", "principal", "admin"],
    write: [],
  },
  mastery_snapshots: {
    classes: ["C", "S+G"],
    read: ["owner", "principal", "admin", "exam_controller", "teacher", "student", "guardian"],
    write: [],
  },

  // 0102 — message_threads/messages: owner/principal/admin read every row of
  // the institution; a guardian reads threads where they are the guardian and
  // the student is their child; a teacher reads threads addressed to them for
  // a student they teach. No insert/update/delete policy: writes are the
  // start_message_thread/send_message/mark_thread_read definer RPCs only
  // (explicit participant scoping proved in tests/db/messaging-rls.test.ts,
  // not by the generated suite's plain own-institution probe).
  message_threads: {
    classes: ["S+G", "T", "O"],
    read: ["owner", "principal", "admin"],
    write: [],
  },
  messages: {
    classes: ["S+G", "T", "O"],
    read: ["owner", "principal", "admin"],
    write: [],
  },

  // 0103 — practice_attempts: leaders read all; student and linked guardians
  // read own/child rows (app.my_student_ids); teachers read taught students
  // (app.my_taught_student_ids). Insert only via submit_practice_attempt;
  // immutable (guard trigger). Scoping proved in tests/db/practice-rls.test.ts.
  practice_attempts: {
    classes: ["S+G", "T", "O"],
    read: ["owner", "principal", "admin"],
    write: [],
  },

  // 0106 (live-fabric "simulator") — simulation_scenarios: owner/principal/
  // admin read + insert/update every row (table-level RLS). Approve/reject
  // (status -> approved/rejected) is further restricted to owner/principal
  // only by the guard trigger, not by this table-level policy — proved in
  // tests/db/simulator-scenarios.test.ts, not by the generated suite's
  // plain own-institution probe.
  simulation_scenarios: {
    classes: ["A"],
    read: ["owner", "principal", "admin"],
    write: ["owner", "principal", "admin"],
  },
  // 20261028000107 (live-fabric studio lane) — studio_requests: leadership
  // (owner/principal/admin) read and INSERT directly; every status
  // transition (propose/approve/reject) is server-only via
  // propose_studio_request/decide_studio_request (no UPDATE grant to
  // authenticated at all) — decide further narrows to owner/principal
  // inside that definer, proved in tests/db/studio-requests.test.ts.
  studio_requests: {
    classes: ["A"],
    read: ["owner", "principal", "admin"],
    write: ["owner", "principal", "admin"],
  },

  // Features-18 (0113-0126). Matrices from each migration header + .superpowers/sdd/features-18/ROLES.md.
  // 0113 behaviour: M all; teacher taught students; student/guardian own/child non-voided. Void via definer only.
  behaviour_incidents: {
    classes: ["S", "T", "O"],
    read: ["owner", "principal", "admin", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin", "teacher"],
  },
  // 0114 health: M rw; guardian reads own children; teachers/students none.
  health_profiles: {
    classes: ["S", "O"],
    read: ["owner", "principal", "admin", "guardian"],
    write: ["owner", "principal", "admin"],
  },
  health_visits: {
    classes: ["S", "O"],
    read: ["owner", "principal", "admin", "guardian"],
    write: ["owner", "principal", "admin"],
  },
  vaccinations: {
    classes: ["S", "O"],
    read: ["owner", "principal", "admin", "guardian"],
    write: ["owner", "principal", "admin"],
  },
  // 0115 clubs/houses: every member reads; M writes; house_points via award_house_points only.
  clubs: {
    classes: ["S"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin"],
  },
  club_events: {
    classes: ["S"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin"],
  },
  houses: {
    classes: ["S"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin"],
  },
  // 0133: staff read all; student/guardian only house-wide rows and their own children's.
  house_points: {
    classes: ["S", "O"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: [],
  },
  // 0115: staff read all; student/guardian own rows (club_*: write via definers only).
  club_members: {
    classes: ["S", "O"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: [],
  },
  club_event_signups: {
    classes: ["S", "O"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: [],
  },
  house_members: {
    classes: ["S", "O"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin"],
  },
  // 0116 hostel: M only (library-shaped); allocations via RPC only.
  hostel_rooms: {
    classes: ["S"],
    read: ["owner", "principal", "admin"],
    write: ["owner", "principal", "admin"],
  },
  hostel_allocations: {
    classes: ["S"],
    read: ["owner", "principal", "admin"],
    write: [],
  },
  hostel_roll_calls: {
    classes: ["S"],
    read: ["owner", "principal", "admin"],
    write: ["owner", "principal", "admin"],
  },
  hostel_roll_call_entries: {
    classes: ["S"],
    read: ["owner", "principal", "admin"],
    write: ["owner", "principal", "admin"],
  },
  // 0117 expenses: finance roles; void via definer.
  expense_categories: {
    classes: ["S"],
    read: ["owner", "principal", "admin", "accountant"],
    write: ["owner", "principal", "admin", "accountant"],
  },
  expenses: {
    classes: ["S"],
    read: ["owner", "principal", "admin", "accountant"],
    write: ["owner", "principal", "admin", "accountant"],
  },
  budgets: {
    classes: ["S"],
    read: ["owner", "principal", "admin", "accountant"],
    write: ["owner", "principal", "admin", "accountant"],
  },
  // 0118 scholarships: finance roles; decision via definer (owner/principal).
  concession_rules: {
    classes: ["S"],
    read: ["owner", "principal", "admin", "accountant"],
    write: ["owner", "principal", "admin", "accountant"],
  },
  concession_awards: {
    classes: ["S"],
    read: ["owner", "principal", "admin", "accountant"],
    write: ["owner", "principal", "admin", "accountant"],
  },
  // 0119 canteen: finance roles + student/guardian read; transactions via definers only.
  canteen_items: {
    classes: ["S", "O"],
    read: ["owner", "principal", "admin", "accountant", "student", "guardian"],
    write: ["owner", "principal", "admin", "accountant"],
  },
  canteen_transactions: {
    classes: ["S", "O"],
    read: ["owner", "principal", "admin", "accountant", "student", "guardian"],
    write: [],
  },
  // 0120 inventory: finance roles; movements via definer only.
  inventory_items: {
    classes: ["S"],
    read: ["owner", "principal", "admin", "accountant"],
    write: ["owner", "principal", "admin", "accountant"],
  },
  inventory_movements: {
    classes: ["S"],
    read: ["owner", "principal", "admin", "accountant"],
    write: [],
  },
  // 0121 helpdesk: M all; teacher/student/guardian own raised; tickets via definers only, messages insertable by M + raiser.
  helpdesk_tickets: {
    classes: ["S", "O"],
    read: ["owner", "principal", "admin", "teacher", "student", "guardian"],
    write: [],
  },
  helpdesk_messages: {
    classes: ["S", "O"],
    read: ["owner", "principal", "admin", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin", "teacher", "student", "guardian"],
  },
  // 0122 forms: M manage; respondents read via my_open_forms definer; responses via submit_form_response only.
  forms: {
    classes: ["S"],
    read: ["owner", "principal", "admin"],
    write: ["owner", "principal", "admin"],
  },
  form_sections: {
    classes: ["S"],
    read: ["owner", "principal", "admin"],
    write: ["owner", "principal", "admin"],
  },
  form_responses: {
    classes: ["S", "O"],
    read: ["owner", "principal", "admin", "teacher", "student", "guardian"],
    write: [],
  },
  // 0123 alumni: read M+admissions; update M columns; rows via sync_alumni only.
  alumni_profiles: {
    classes: ["S"],
    read: ["owner", "principal", "admin", "admissions"],
    write: ["owner", "principal", "admin"],
  },
  // 0124 payroll: owner/accountant manage; other staff read own payslips + finalized runs; writes via definers.
  salary_structures: {
    classes: ["S"],
    read: ["owner", "accountant"],
    write: ["owner", "accountant"],
  },
  payroll_runs: {
    classes: ["S", "O"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher"],
    write: [],
  },
  payslips: {
    classes: ["S", "O"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher"],
    write: [],
  },
  // 0126 school labs: lab.read = M + teacher; M manages; teacher books/logs own via definers/RLS.
  school_labs: {
    classes: ["S"],
    read: ["owner", "principal", "admin", "teacher"],
    write: ["owner", "principal", "admin"],
  },
  school_lab_bookings: {
    classes: ["S"],
    read: ["owner", "principal", "admin", "teacher"],
    write: [],
  },
  school_lab_equipment: {
    classes: ["S"],
    read: ["owner", "principal", "admin", "teacher"],
    write: ["owner", "principal", "admin"],
  },
  school_lab_experiments: {
    classes: ["S", "T"],
    read: ["owner", "principal", "admin", "teacher"],
    write: ["owner", "principal", "admin", "teacher"],
  },
  school_lab_incidents: {
    classes: ["S", "T"],
    read: ["owner", "principal", "admin", "teacher"],
    write: ["owner", "principal", "admin", "teacher"],
  },
  // 0128-0132 (features-18 tail): roles from ROLES.md + each migration's RLS matrix.
  // 0128: M all; teacher taught students; student/guardian own/child non-voided; insert only (verify/void via definers).
  achievements: {
    classes: ["S", "T", "O"],
    read: ["owner", "principal", "admin", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin", "teacher"],
  },
  // 0130: compliance.read = M + accountant; M writes (insert/update/delete); renew via definer.
  compliance_items: {
    classes: ["S"],
    read: ["owner", "principal", "admin", "accountant"],
    write: ["owner", "principal", "admin"],
  },
  // 0130: append-only renewal history, written only by renew_compliance_item.
  compliance_events: {
    classes: ["S"],
    read: ["owner", "principal", "admin", "accountant"],
    write: [],
  },
  // 0132: roster public to staff; written by generate_duty_roster / swap definers.
  duty_assignments: {
    classes: ["S"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher"],
    write: [],
  },
  // 0132: M all; teacher only swaps they are party to; writes via definers.
  duty_swap_requests: {
    classes: ["S", "T"],
    read: ["owner", "principal", "admin", "teacher"],
    write: [],
  },
  // 0132: staff read; M insert/update.
  duty_types: {
    classes: ["S"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher"],
    write: ["owner", "principal", "admin"],
  },
  // 0131: M all; staff published; teacher own; student/guardian published for own sections.
  resources: {
    classes: ["S+G", "T"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin", "teacher"],
  },
  // 0131: select follows parent resource visibility; M/teacher(own, taught section) insert/delete.
  resource_sections: {
    classes: ["S", "T"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin", "teacher"],
  },
  // 0129: staff all; members audience=all; student/guardian sections audience. Created/closed via definers.
  safety_alerts: {
    classes: ["S"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: [],
  },
  // 0129: staff all; student/guardian own sections. Via definers.
  safety_alert_sections: {
    classes: ["S"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: [],
  },
  // 0129: M all; others own row. Via acknowledge_safety_alert.
  safety_acknowledgements: {
    classes: ["S", "O"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: [],
  },
  // 0129: M all; teacher taught sections. Via mark_safety_headcount.
  safety_headcounts: {
    classes: ["S", "T"],
    read: ["owner", "principal", "admin", "teacher"],
    write: [],
  },
  // 0138 — study studio. Material: owner only (student private, teacher own);
  // teacher material shared to taught sections (enrolled students read) and
  // read by M. Per-student rows: student + linked guardian read, M read, a
  // teacher reads only rows on their own shared material for taught students.
  // Scoping proved in tests/db/study-studio.test.ts.
  study_materials: {
    classes: ["O", "T"],
    read: ["owner", "principal", "admin", "teacher", "student"],
    write: ["teacher", "student"],
  },
  study_material_sections: {
    classes: ["T"],
    read: ["owner", "principal", "admin", "teacher", "student"],
    write: ["teacher"],
  },
  study_deck_progress: {
    classes: ["S+G", "T", "O"],
    read: ["owner", "principal", "admin", "teacher", "student", "guardian"],
    write: ["student"],
  },
  study_quiz_attempts: {
    classes: ["S+G", "T", "O"],
    read: ["owner", "principal", "admin", "teacher", "student", "guardian"],
    write: ["student"],
  },
  study_plans: {
    classes: ["S+G", "O"],
    read: ["student", "guardian"],
    write: ["student"],
  },
  study_sessions: {
    classes: ["S+G", "O"],
    read: ["owner", "principal", "admin", "student", "guardian"],
    write: ["student"],
  },
  // 0139 — textbooks + curriculum materials (ncert_textbooks is global, no
  // institution_id). Mapping: members read; leaders + the subject's teacher
  // write. Unit chapters: staff read, students/guardians of that grade+subject.
  // Materials: class files to staff + that grade/subject's students/guardians;
  // a student's private file to them + guardian only; uploads by staff/students.
  // Scoping proved in tests/db/textbooks-materials.test.ts.
  subject_textbooks: {
    classes: ["S+G", "T"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin", "teacher"],
  },
  curriculum_unit_chapters: {
    classes: ["S+G", "T"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin", "teacher"],
  },
  curriculum_materials: {
    classes: ["S+G", "T", "O"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin", "teacher", "student"],
  },
};
