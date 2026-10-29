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
    write: ["owner", "principal", "admin"], // UPDATE (requeue) only; no INSERT policy
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
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin", "admissions"],
  },
  guardians: {
    classes: ["S+G"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "teacher", "guardian"], // teacher/guardian scoped
    write: ["owner", "principal", "admin", "admissions"],
  },
  guardian_students: {
    classes: ["S+G"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin", "admissions"],
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
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin", "admissions"],
  },
  enrolment_status_history: {
    classes: ["A"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: [], // trigger-only
  },
  curriculum_units: {
    classes: ["S+G"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "admin"],
  },
  assignments: {
    classes: ["S+G", "T"],
    read: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
    write: ["owner", "principal", "teacher"], // teacher scoped to sections they teach
  },
  assignment_submissions: {
    classes: ["O", "T"],
    read: ["teacher", "student", "guardian"], // teacher scoped to their sections; no staff-wide read
    write: ["student"], // own submission only (P1)
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
    write: ["owner", "principal", "admin", "teacher"], // teacher scoped to sections they teach; INSERT/UPDATE also require the student to be enrolled in that section
  },
  attendance_records: {
    classes: ["S+G", "T"],
    read: ["owner", "principal", "admin", "exam_controller", "teacher", "student", "guardian"], // teacher scoped via the record's session's section
    write: ["owner", "principal", "admin", "teacher"], // teacher scoped via the record's session's section; student_id must be enrolled in that section (CRITICAL fix, security review)
  },
  attendance_corrections: {
    classes: ["S+G", "T"],
    read: ["owner", "principal", "admin", "exam_controller", "teacher", "student", "guardian"], // teacher scoped via the corrected record's session's section
    write: ["owner", "principal", "admin", "teacher"], // INSERT-only; append-only (block_mutation)
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
    write: ["owner", "principal", "admin", "admissions"],
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
};
