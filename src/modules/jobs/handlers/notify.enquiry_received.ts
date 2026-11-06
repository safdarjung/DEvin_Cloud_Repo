// T-038 — 06 §W3/§3: notify every member with the `admissions` role of a
// new public enquiry. Payload: `{ enquiry_id: uuid, ... }`
// (`app.submit_public_enquiry`, 20261028000007). The message is built from
// the current `enquiries`/`grades` rows, never from the payload's
// `child_name`/`guardian_name`/`phone` fields (lead ruling).
import { createNotification } from "../../notifications/service.ts";
import { emitWorkflowEvent } from "../../workflows/events.ts";
import type { JobHandler } from "../types.ts";

export const notifyEnquiryReceived: JobHandler = async (job, { admin }) => {
  const enquiryId = job.payload.enquiry_id;
  if (typeof enquiryId !== "string" || enquiryId.length === 0) {
    throw new Error("notify.enquiry_received: missing enquiry_id");
  }

  const { data: enquiry, error: enquiryError } = await admin
    .from("enquiries")
    .select("id, institution_id, child_name, guardian_name, grade_applied_id")
    .eq("id", enquiryId)
    .maybeSingle();
  if (enquiryError) throw enquiryError;
  if (!enquiry) return;

  // M23-T14: one workflow event per enquiry (rulings §Events).
  await emitWorkflowEvent(admin, enquiry.institution_id, "enquiry.received", enquiry.id);

  let gradeLabel = "—";
  if (enquiry.grade_applied_id) {
    const { data: grade, error: gradeError } = await admin
      .from("grades")
      .select("display_name")
      .eq("id", enquiry.grade_applied_id)
      .maybeSingle();
    if (gradeError) throw gradeError;
    if (grade) gradeLabel = grade.display_name;
  }

  const { data: members, error: membersError } = await admin
    .from("memberships")
    .select("user_id")
    .eq("institution_id", enquiry.institution_id)
    .eq("role", "admissions")
    .eq("status", "active");
  if (membersError) throw membersError;

  for (const member of members ?? []) {
    await createNotification(admin, {
      institutionId: enquiry.institution_id,
      recipientUserId: member.user_id,
      type: "enquiry_received",
      entityId: enquiry.id,
      vars: {
        child: enquiry.child_name,
        grade: gradeLabel,
        guardian: enquiry.guardian_name,
      },
    });
  }
};
