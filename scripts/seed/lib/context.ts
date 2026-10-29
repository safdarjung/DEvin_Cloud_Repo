import type { SupabaseClient } from "@supabase/supabase-js";
import type postgres from "postgres";
import type { Database } from "../../../src/lib/db/types.ts";

/** State later sections read, produced by earlier sections (09 §4, 05 §8). */
export interface SeedContext {
  rng: () => number;
  admin: SupabaseClient<Database>;
  /** Direct Postgres connection — needed for `app.*` functions (e.g. `next_sequence`), which live outside the PostgREST-exposed `public` schema. */
  sql: ReturnType<typeof postgres>;
  institutionId: string;
  campusId: string;
  academicYearId: string;
  termIds: { term1: string; term2: string };
  /** Demo login key (e.g. "principal", "teacher.vi-a") -> auth user id. */
  userIdByLogin: Record<string, string>;
  /** Demo login key -> that user's staff_id/guardian_id/student_id, whichever applies. */
  linkIdByLogin: Record<string, string>;
  /** people -> academics (T-013): every teaching staff id (100 total; the 3 demo class teachers first), for subject_assignments round-robin. */
  teacherStaffIds: string[];
  /** people -> academics (T-013): per `${gradeCode}-${sectionName}` (e.g. "VI-A"), that section's 42 students; academics.ts sorts by firstName to assign roll_no 1-42. */
  studentsBySection: Record<string, { id: string; firstName: string }[]>;
}

export function createSeedContext(
  rng: () => number,
  admin: SupabaseClient<Database>,
  sql: ReturnType<typeof postgres>,
): SeedContext {
  return {
    rng,
    admin,
    sql,
    institutionId: "",
    campusId: "",
    academicYearId: "",
    termIds: { term1: "", term2: "" },
    userIdByLogin: {},
    linkIdByLogin: {},
    teacherStaffIds: [],
    studentsBySection: {},
  };
}
