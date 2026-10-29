import type { FixtureRole } from "@/../tests/helpers/roles";

export type PolicyClass = "S" | "S+G" | "C" | "T" | "A" | "P" | "O";

export interface TableExpectation {
  classes: PolicyClass[];
  /** Roles that can SELECT this table's rows within their own institution. */
  read: FixtureRole[];
  /** Roles that can INSERT/UPDATE this table's rows within their own institution. */
  write: FixtureRole[];
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
};
