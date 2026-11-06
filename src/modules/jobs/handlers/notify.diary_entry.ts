// X01-T10 — 06 rulings "Notifications": notify a diary entry's section
// audience (guardians with portal access + the students themselves).
// Payload: `{ entry_id: uuid }` (`app.enqueue_diary_entry_notification`
// trigger, 0085, `idempotency_key = diary:<entry_id>`). In-app only (no SMS
// cost for every homework post).
import { resolveRecipients } from "./notify.announcement.ts";
import { createNotification } from "../../notifications/service.ts";
import type { JobHandler } from "../types.ts";

const EXCERPT_LENGTH = 120;

export const notifyDiaryEntry: JobHandler = async (job, { admin }) => {
  const entryId = job.payload.entry_id;
  if (typeof entryId !== "string" || entryId.length === 0) {
    throw new Error("notify.diary_entry: missing entry_id");
  }

  const { data: entry, error: entryError } = await admin
    .from("diary_entries")
    .select("id, institution_id, class_section_id, subject_id, body")
    .eq("id", entryId)
    .maybeSingle();
  if (entryError) throw entryError;
  // Deleted (author delete + repost, or a stale rerun) — nothing to notify.
  if (!entry) return;

  const { data: section, error: sectionError } = await admin
    .from("class_sections")
    .select("name, grade_id")
    .eq("id", entry.class_section_id)
    .single();
  if (sectionError) throw sectionError;

  const { data: grade, error: gradeError } = await admin
    .from("grades")
    .select("code")
    .eq("id", section.grade_id)
    .single();
  if (gradeError) throw gradeError;

  let subjectName = "General";
  if (entry.subject_id) {
    const { data: subject, error: subjectError } = await admin
      .from("subjects")
      .select("name")
      .eq("id", entry.subject_id)
      .single();
    if (subjectError) throw subjectError;
    subjectName = subject.name;
  }

  const { data: institution, error: institutionError } = await admin
    .from("institutions")
    .select("settings")
    .eq("id", entry.institution_id)
    .single();
  if (institutionError) throw institutionError;
  const languages = (institution.settings as { communication?: { languages?: unknown } } | null)?.communication
    ?.languages;
  const lang = Array.isArray(languages) && languages[0] === "hi" ? "hi" : "en";

  const recipients = await resolveRecipients(admin, entry.institution_id, [
    { audience_type: "section", role: null, grade_id: null, class_section_id: entry.class_section_id },
  ]);

  for (const recipient of recipients) {
    await createNotification(admin, {
      institutionId: entry.institution_id,
      recipientUserId: recipient.userId,
      type: "diary_entry",
      entityId: entry.id,
      lang,
      vars: {
        section: `${grade.code}-${section.name}`,
        subject: subjectName,
        excerpt: entry.body.slice(0, EXCERPT_LENGTH),
      },
      contacts: recipient.contacts,
    });
  }
};
