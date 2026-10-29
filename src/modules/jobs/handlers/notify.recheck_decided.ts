// T-020 (replaces T-038's placeholder; 06 §W8/§3). Payload:
// `{ request_id, decision, result_id }` (app.apply_recheck_decision,
// 20261028000009, enqueues one of these per decision with
// `idempotency_key = recheck:<request_id>`). Every value in the rendered
// message is re-read from the current DB rows below — never the payload —
// same shape as notify.results_published.ts. Single recipient: the
// requester (`recheck_requests.requested_by`, pinned to the caller at
// insert time, 06 §W8), not every guardian — a recheck is that one person's
// request, unlike a published result.
import { createNotification } from "../../notifications/service.ts";
import type { JobHandler } from "../types.ts";

const FINAL_STATUSES = new Set(["applied", "rejected"]);

export const notifyRecheckDecided: JobHandler = async (job, { admin }) => {
  const requestId = job.payload.request_id;
  if (typeof requestId !== "string" || requestId.length === 0) {
    throw new Error("notify.recheck_decided: missing request_id");
  }

  const { data: request, error: requestError } = await admin
    .from("recheck_requests")
    .select("id, institution_id, result_id, exam_paper_id, requested_by, status")
    .eq("id", requestId)
    .maybeSingle();
  if (requestError) throw requestError;
  // Deleted, or the job is stale — nothing to notify about.
  if (!request || !request.requested_by) return;
  // Re-check state at send time (lead ruling, same as notify.results_published):
  // decisions are final (06 §W8), but never send on a stale assumption.
  if (!FINAL_STATUSES.has(request.status)) return;

  const { data: decision, error: decisionError } = await admin
    .from("recheck_decisions")
    .select("decision, new_marks")
    .eq("request_id", requestId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (decisionError) throw decisionError;
  if (!decision) return;

  const { data: result, error: resultError } = await admin
    .from("results")
    .select("student_id")
    .eq("id", request.result_id)
    .eq("institution_id", request.institution_id)
    .maybeSingle();
  if (resultError) throw resultError;
  if (!result) return;

  const { data: paper, error: paperError } = await admin
    .from("exam_papers")
    .select("subject_id")
    .eq("id", request.exam_paper_id)
    .eq("institution_id", request.institution_id)
    .maybeSingle();
  if (paperError) throw paperError;
  if (!paper) return;

  const [{ data: subject, error: subjectError }, { data: student, error: studentError }, { data: institution, error: institutionError }, { data: marksRow, error: marksError }] =
    await Promise.all([
      admin.from("subjects").select("name").eq("id", paper.subject_id).eq("institution_id", request.institution_id).maybeSingle(),
      admin
        .from("students")
        .select("first_name, last_name")
        .eq("id", result.student_id)
        .eq("institution_id", request.institution_id)
        .maybeSingle(),
      admin.from("institutions").select("name, settings").eq("id", request.institution_id).single(),
      admin
        .from("marks")
        .select("marks_obtained")
        .eq("exam_paper_id", request.exam_paper_id)
        .eq("student_id", result.student_id)
        .is("superseded_by", null)
        .maybeSingle(),
    ]);
  if (subjectError) throw subjectError;
  if (studentError) throw studentError;
  if (institutionError) throw institutionError;
  if (marksError) throw marksError;

  const languages = (institution.settings as { communication?: { languages?: unknown } } | null)?.communication
    ?.languages;
  const lang = Array.isArray(languages) && languages[0] === "hi" ? "hi" : "en";

  const vars = {
    student: [student?.first_name, student?.last_name].filter(Boolean).join(" "),
    subject: subject?.name ?? "",
    decision: decision.decision === "approve" ? "approved" : "rejected",
    marks: marksRow?.marks_obtained != null ? String(marksRow.marks_obtained) : "—",
    school: institution.name,
  };

  // Phone for the simulated SMS channel, resolved from the requester's own
  // active guardian membership (never the job payload) — null (and the sms
  // channel records "failed: no_contact") when the requester is a student
  // or has no phone on file, same pattern as notify.results_published's
  // student recipient.
  const { data: membership, error: membershipError } = await admin
    .from("memberships")
    .select("role, guardian_id")
    .eq("institution_id", request.institution_id)
    .eq("user_id", request.requested_by)
    .eq("status", "active")
    .in("role", ["guardian", "student"])
    .maybeSingle();
  if (membershipError) throw membershipError;

  let phone: string | null = null;
  if (membership?.role === "guardian" && membership.guardian_id) {
    const { data: guardian, error: guardianError } = await admin
      .from("guardians")
      .select("phone")
      .eq("id", membership.guardian_id)
      .maybeSingle();
    if (guardianError) throw guardianError;
    phone = guardian?.phone ?? null;
  }

  await createNotification(admin, {
    institutionId: request.institution_id,
    recipientUserId: request.requested_by,
    type: "recheck_decided",
    entityId: request.id,
    lang,
    vars,
    contacts: { sms: phone },
  });
};
