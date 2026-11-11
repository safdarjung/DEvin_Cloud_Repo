// Features-18 #21 — who a safety alert reaches. One resolver for both the
// notify.safety_alert job (service-role client) and the manager's "This will
// notify N people" preview / acknowledgement counts (manager's RLS client —
// owner/principal/admin read every memberships/enrolments/guardian_students
// row of their institution, so both clients see the same rows).
//
// Mirrors safety_alerts_select (0129) exactly, ACTIVE memberships only:
//   all      -> every active membership of the institution
//   staff    -> active memberships with a staff role (app.staff_roles())
//   sections -> staff, plus active student memberships whose student has an
//               active enrolment in a targeted section, plus active guardian
//               memberships linked (same institution) to such a student —
//               app.my_student_section_ids() has no academic-year and no
//               portal_access filter, so neither is applied here.
// Paged (PostgREST caps a response at max_rows) and chunked `.in()` lists, so
// a whole-school alert never silently drops recipients.
//
// Plain-node file (loaded by `pnpm jobs:run`): relative imports, type-only `@/`.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { SafetyAudience } from "./schemas.ts";

/** Mirrors app.staff_roles() (0001). */
export const SAFETY_STAFF_ROLES = ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher"] as const;

const PAGE = 500;
const CHUNK = 100;

export type AudienceGroup = "staff" | "student" | "guardian";

export interface AudienceMember {
  userId: string;
  group: AudienceGroup;
  staffId: string | null;
  guardianId: string | null;
  studentId: string | null;
}

interface MembershipRow {
  user_id: string;
  role: string;
  staff_id: string | null;
  guardian_id: string | null;
  student_id: string | null;
}

type Client = SupabaseClient<Database>;
type PageResult<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

async function paged<T>(fetchPage: (from: number, to: number) => PageResult<T>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

export function chunked<T>(items: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const MEMBER_COLUMNS = "user_id, role, staff_id, guardian_id, student_id";

function groupOf(role: string): AudienceGroup {
  if (role === "student") return "student";
  if (role === "guardian") return "guardian";
  return "staff";
}

async function activeMembers(client: Client, institutionId: string, roles: readonly string[] | null): Promise<MembershipRow[]> {
  return paged<MembershipRow>((from, to) => {
    let q = client.from("memberships").select(MEMBER_COLUMNS).eq("institution_id", institutionId).eq("status", "active");
    if (roles) q = q.in("role", [...roles]);
    return q.order("id").range(from, to);
  });
}

async function sectionStudentIds(client: Client, institutionId: string, sectionIds: readonly string[]): Promise<string[]> {
  const ids = new Set<string>();
  for (const part of chunked(sectionIds)) {
    const rows = await paged<{ student_id: string }>((from, to) =>
      client
        .from("enrolments")
        .select("student_id")
        .eq("institution_id", institutionId)
        .eq("status", "active")
        .in("class_section_id", part)
        .order("id")
        .range(from, to),
    );
    for (const r of rows) ids.add(r.student_id);
  }
  return [...ids];
}

async function membersByLink(
  client: Client,
  institutionId: string,
  role: "student" | "guardian",
  column: "student_id" | "guardian_id",
  linkIds: readonly string[],
): Promise<MembershipRow[]> {
  const out: MembershipRow[] = [];
  for (const part of chunked(linkIds)) {
    out.push(
      ...(await paged<MembershipRow>((from, to) =>
        client
          .from("memberships")
          .select(MEMBER_COLUMNS)
          .eq("institution_id", institutionId)
          .eq("status", "active")
          .eq("role", role)
          .in(column, part)
          .order("id")
          .range(from, to),
      )),
    );
  }
  return out;
}

async function linkedGuardianIds(client: Client, institutionId: string, studentIds: readonly string[]): Promise<string[]> {
  const ids = new Set<string>();
  for (const part of chunked(studentIds)) {
    const rows = await paged<{ guardian_id: string }>((from, to) =>
      client
        .from("guardian_students")
        .select("guardian_id")
        .eq("institution_id", institutionId)
        .in("student_id", part)
        .order("guardian_id")
        .order("student_id")
        .range(from, to),
    );
    for (const r of rows) ids.add(r.guardian_id);
  }
  return [...ids];
}

/** Distinct users in the alert's audience; staff first (a user holding a staff and a guardian role counts once, as staff). */
export async function resolveSafetyAudience(
  client: Client,
  institutionId: string,
  audience: SafetyAudience,
  sectionIds: readonly string[],
): Promise<AudienceMember[]> {
  const rows: MembershipRow[] = [];
  if (audience === "all") {
    const all = await activeMembers(client, institutionId, null);
    rows.push(...all.filter((r) => groupOf(r.role) === "staff"), ...all.filter((r) => groupOf(r.role) !== "staff"));
  } else {
    rows.push(...(await activeMembers(client, institutionId, SAFETY_STAFF_ROLES)));
  }

  if (audience === "sections" && sectionIds.length > 0) {
    const studentIds = await sectionStudentIds(client, institutionId, sectionIds);
    if (studentIds.length > 0) {
      rows.push(...(await membersByLink(client, institutionId, "student", "student_id", studentIds)));
      const guardianIds = await linkedGuardianIds(client, institutionId, studentIds);
      rows.push(...(await membersByLink(client, institutionId, "guardian", "guardian_id", guardianIds)));
    }
  }

  const byUser = new Map<string, AudienceMember>();
  for (const r of rows) {
    if (byUser.has(r.user_id)) continue;
    byUser.set(r.user_id, {
      userId: r.user_id,
      group: groupOf(r.role),
      staffId: r.staff_id,
      guardianId: r.guardian_id,
      studentId: r.student_id,
    });
  }
  return [...byUser.values()];
}
