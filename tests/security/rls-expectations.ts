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
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher"],
    write: ["owner", "principal", "admin"],
  },
  memberships: {
    classes: ["O"],
    read: ["owner", "principal", "admin"],
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
  // 0077 (M15-T3) — scheduled_reports: report.schedule is owner/principal/
  // admin only (07 §2.2); no DELETE policy (pause instead of delete).
  scheduled_reports: {
    classes: ["A"],
    read: ["owner", "principal", "admin"],
    write: ["owner", "principal", "admin"],
  },
};
