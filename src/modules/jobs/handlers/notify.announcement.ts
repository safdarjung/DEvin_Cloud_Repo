// M06-T3 — fans out a published announcement to its audiences (06
// M06-tasks.md header rulings). Payload: `{ announcement_id: uuid }`
// (`publish_announcement`, 0068). Every recipient and contact below is
// re-read from current rows — never from the payload.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { createNotification } from "../../notifications/service.ts";
import type { JobHandler } from "../types.ts";

interface AudienceRow {
  audience_type: string;
  role: string | null;
  grade_id: string | null;
  class_section_id: string | null;
}

interface Recipient {
  userId: string;
  contacts: { sms?: string | null; email?: string | null };
}

type Contacts = Recipient["contacts"];

async function contactsById(
  admin: SupabaseClient<Database>,
  table: "guardians" | "staff",
  ids: readonly string[],
): Promise<Map<string, Contacts>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await admin.from(table).select("id, phone, email").in("id", ids);
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.id, { sms: row.phone, email: row.email }]));
}

/** `school` (no role filter) and `role` audiences: every active membership, contacts from its guardian/staff row. */
async function loadActiveMembers(
  admin: SupabaseClient<Database>,
  institutionId: string,
  role: string | null,
): Promise<Recipient[]> {
  let query = admin
    .from("memberships")
    .select("user_id, guardian_id, staff_id")
    .eq("institution_id", institutionId)
    .eq("status", "active");
  if (role) query = query.eq("role", role);
  const { data, error } = await query;
  if (error) throw error;
  const rows = data ?? [];

  const guardianIds = [...new Set(rows.flatMap((r) => (r.guardian_id ? [r.guardian_id] : [])))];
  const staffIds = [...new Set(rows.flatMap((r) => (r.staff_id ? [r.staff_id] : [])))];
  const [guardianContacts, staffContacts] = await Promise.all([
    contactsById(admin, "guardians", guardianIds),
    contactsById(admin, "staff", staffIds),
  ]);

  return rows.map((r) => ({
    userId: r.user_id,
    contacts:
      (r.guardian_id ? guardianContacts.get(r.guardian_id) : null) ??
      (r.staff_id ? staffContacts.get(r.staff_id) : null) ??
      {},
  }));
}

async function currentAcademicYearId(admin: SupabaseClient<Database>, institutionId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("academic_years")
    .select("id")
    .eq("institution_id", institutionId)
    .eq("is_current", true)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

/** `grade`/`section` audiences: students actively enrolled there this academic year (06 rulings). */
async function activelyEnrolledStudentIds(
  admin: SupabaseClient<Database>,
  institutionId: string,
  academicYearId: string,
  audience: AudienceRow,
): Promise<string[]> {
  let classSectionIds: string[];
  if (audience.audience_type === "section") {
    classSectionIds = audience.class_section_id ? [audience.class_section_id] : [];
  } else {
    const { data, error } = await admin
      .from("class_sections")
      .select("id")
      .eq("institution_id", institutionId)
      .eq("grade_id", audience.grade_id as string);
    if (error) throw error;
    classSectionIds = (data ?? []).map((s) => s.id);
  }
  if (classSectionIds.length === 0) return [];

  const { data, error } = await admin
    .from("enrolments")
    .select("student_id")
    .eq("institution_id", institutionId)
    .eq("academic_year_id", academicYearId)
    .eq("status", "active")
    .in("class_section_id", classSectionIds);
  if (error) throw error;
  return [...new Set((data ?? []).map((e) => e.student_id))];
}

/** Guardians (with portal access) + the students themselves, for a resolved student_id list. */
async function guardiansAndStudents(
  admin: SupabaseClient<Database>,
  institutionId: string,
  studentIds: readonly string[],
): Promise<Recipient[]> {
  if (studentIds.length === 0) return [];

  const { data: gsRows, error: gsError } = await admin
    .from("guardian_students")
    .select("guardian_id")
    .eq("institution_id", institutionId)
    .eq("portal_access", true)
    .in("student_id", studentIds);
  if (gsError) throw gsError;
  const guardianIds = [...new Set((gsRows ?? []).map((r) => r.guardian_id))];

  const [guardianContacts, guardianMemberships, studentMemberships] = await Promise.all([
    contactsById(admin, "guardians", guardianIds),
    guardianIds.length
      ? admin
          .from("memberships")
          .select("user_id, guardian_id")
          .eq("institution_id", institutionId)
          .eq("role", "guardian")
          .eq("status", "active")
          .in("guardian_id", guardianIds)
          .then(({ data, error }) => {
            if (error) throw error;
            return data ?? [];
          })
      : Promise.resolve([]),
    admin
      .from("memberships")
      .select("user_id")
      .eq("institution_id", institutionId)
      .eq("role", "student")
      .eq("status", "active")
      .in("student_id", studentIds)
      .then(({ data, error }) => {
        if (error) throw error;
        return data ?? [];
      }),
  ]);

  const recipients: Recipient[] = guardianMemberships.map((m) => ({
    userId: m.user_id,
    contacts: guardianContacts.get(m.guardian_id as string) ?? {},
  }));
  for (const m of studentMemberships) recipients.push({ userId: m.user_id, contacts: {} });
  return recipients;
}

async function resolveRecipients(
  admin: SupabaseClient<Database>,
  institutionId: string,
  audiences: readonly AudienceRow[],
): Promise<Recipient[]> {
  const byUser = new Map<string, Recipient>();
  const add = (list: Recipient[]) => {
    for (const r of list) if (!byUser.has(r.userId)) byUser.set(r.userId, r);
  };

  let academicYearId: string | null | undefined;

  for (const audience of audiences) {
    if (audience.audience_type === "school") {
      add(await loadActiveMembers(admin, institutionId, null));
    } else if (audience.audience_type === "role") {
      add(await loadActiveMembers(admin, institutionId, audience.role));
    } else {
      if (academicYearId === undefined) academicYearId = await currentAcademicYearId(admin, institutionId);
      if (!academicYearId) continue; // no current academic year — nothing actively enrolled to notify
      const studentIds = await activelyEnrolledStudentIds(admin, institutionId, academicYearId, audience);
      add(await guardiansAndStudents(admin, institutionId, studentIds));
    }
  }

  return [...byUser.values()];
}

export const notifyAnnouncement: JobHandler = async (job, { admin }) => {
  const announcementId = job.payload.announcement_id;
  if (typeof announcementId !== "string" || announcementId.length === 0) {
    throw new Error("notify.announcement: missing announcement_id");
  }

  const { data: announcement, error: announcementError } = await admin
    .from("announcements")
    .select("id, institution_id, title, body, status")
    .eq("id", announcementId)
    .maybeSingle();
  if (announcementError) throw announcementError;
  // Re-check state at send time: deleted, or no longer published — skip rather than send stale.
  if (!announcement || announcement.status !== "published") return;

  const { data: audiences, error: audiencesError } = await admin
    .from("announcement_audiences")
    .select("audience_type, role, grade_id, class_section_id")
    .eq("announcement_id", announcement.id);
  if (audiencesError) throw audiencesError;
  if (!audiences || audiences.length === 0) return;

  const recipients = await resolveRecipients(admin, announcement.institution_id, audiences);
  const excerpt = announcement.body.slice(0, 280);

  // shortcut: one createNotification call per recipient, sequentially; fine
  // up to the ~5,000-recipient range a "school" audience realistically hits
  // at this scale. Batch (bulk notification + delivery_attempts insert)
  // once a school audience grows past that.
  for (const recipient of recipients) {
    await createNotification(admin, {
      institutionId: announcement.institution_id,
      recipientUserId: recipient.userId,
      type: "announcement",
      entityId: announcement.id,
      vars: { title: announcement.title, excerpt },
      contacts: recipient.contacts,
    });
  }
};
