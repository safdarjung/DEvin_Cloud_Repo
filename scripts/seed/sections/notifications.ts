import { createNotification } from "../../../src/modules/notifications/service.ts";
import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";
import { SCHOOL_DAYS } from "./attendance.ts";

// X05-T6 (X05-tasks.md Task 6). Registered last in scripts/seed/index.ts:
// needs guardian.one/guardian.two's auth user ids (core.ts), Aarav's
// section (people.ts) and the attendance window's first day (attendance.ts).
// `createNotification` is idempotent on `type:entityId:recipientUserId`
// (service.ts), so rerunning this section on a reseed adds no rows.

export async function run(ctx: SeedContext): Promise<void> {
  const [{ data: institution, error: institutionError }, { data: guardianOne, error: guardianOneError }, { data: guardianTwo, error: guardianTwoError }] =
    await Promise.all([
      ctx.admin.from("institutions").select("name").eq("id", ctx.institutionId).single(),
      ctx.admin.from("guardians").select("phone").eq("id", ctx.linkIdByLogin["guardian.one"]!).single(),
      ctx.admin.from("guardians").select("phone").eq("id", ctx.linkIdByLogin["guardian.two"]!).single(),
    ]);
  if (institutionError) throw institutionError;
  if (guardianOneError) throw guardianOneError;
  if (guardianTwoError) throw guardianTwoError;

  // Rulings "Opt-out" — guardian.two opts announcement out of whatsapp.
  const { error: preferenceError } = await ctx.admin.from("notification_preferences").upsert(
    {
      user_id: ctx.userIdByLogin["guardian.two"]!,
      institution_id: ctx.institutionId,
      category: "announcement",
      channel: "whatsapp",
      enabled: false,
    },
    { onConflict: "user_id,institution_id,category,channel" },
  );
  if (preferenceError) throw preferenceError;

  const announcementVars = {
    title: "Annual Day on 21 November",
    excerpt: "Parents are invited to the Annual Day function at 10 am in the school hall.",
  };
  const announcementEntityId = uuidV5("notifications", "announcement:annual-day");
  await createNotification(ctx.admin, {
    institutionId: ctx.institutionId,
    recipientUserId: ctx.userIdByLogin["guardian.one"]!,
    type: "announcement",
    entityId: announcementEntityId,
    vars: announcementVars,
    contacts: { sms: guardianOne!.phone },
  });
  await createNotification(ctx.admin, {
    institutionId: ctx.institutionId,
    recipientUserId: ctx.userIdByLogin["guardian.two"]!,
    type: "announcement",
    entityId: announcementEntityId,
    vars: announcementVars,
    contacts: { sms: guardianTwo!.phone },
  });
  // student.one (Ananya) also gets the announcement directly — one of her
  // >=3 notifications (results_published + diary_entry below are the others).
  await createNotification(ctx.admin, {
    institutionId: ctx.institutionId,
    recipientUserId: ctx.userIdByLogin["student.one"]!,
    type: "announcement",
    entityId: announcementEntityId,
    vars: announcementVars,
  });

  // Aarav Sharma (guardian.one's first child, VI-A) — the section key is
  // already "<grade.code>-<section.name>" (notify.attendance_absence.ts),
  // so it doubles as the `class` var with no extra lookup.
  const aarav = ctx.studentsBySection["VI-A"]!.find((s) => s.firstName === "Aarav")!;
  await createNotification(ctx.admin, {
    institutionId: ctx.institutionId,
    recipientUserId: ctx.userIdByLogin["guardian.one"]!,
    type: "attendance_absence",
    entityId: uuidV5("notifications", `attendance-absence:${aarav.id}`),
    lang: "hi",
    vars: {
      student: "Aarav Sharma",
      class: "VI-A",
      date: SCHOOL_DAYS[0]!,
      school: institution!.name,
    },
    contacts: { sms: guardianOne!.phone },
  });

  // Owner decision (2026-11-07): the demo student section must not be empty
  // — student.one and both guardians get a handful of in-app notifications
  // (05 §8.2's "zero homework" count moved to homework.ts; this section
  // adds the matching notification feed). Mark the two oldest as read
  // below so the portal shows a mix of read/unread.
  const ananya = ctx.studentsBySection["X-A"]!.find((s) => s.firstName === "Ananya")!;
  const { data: aaravInvoice, error: aaravInvoiceError } = await ctx.admin
    .from("invoices")
    .select("invoice_no, total, due_on")
    .eq("institution_id", ctx.institutionId)
    .eq("student_id", aarav.id)
    .eq("term_id", ctx.termIds.term2)
    .eq("status", "issued")
    .single();
  if (aaravInvoiceError) throw aaravInvoiceError;

  const readResults = await createNotification(ctx.admin, {
    institutionId: ctx.institutionId,
    recipientUserId: ctx.userIdByLogin["student.one"]!,
    type: "results_published",
    entityId: uuidV5("notifications", `results-published:${ananya.id}:HY-2026`),
    vars: { student: "Ananya Sharma", exam: "Half-Yearly Examination 2026", school: institution!.name },
  });
  await createNotification(ctx.admin, {
    institutionId: ctx.institutionId,
    recipientUserId: ctx.userIdByLogin["guardian.one"]!,
    type: "results_published",
    entityId: uuidV5("notifications", `results-published:${ananya.id}:HY-2026`),
    vars: { student: "Ananya Sharma", exam: "Half-Yearly Examination 2026", school: institution!.name },
    contacts: { sms: guardianOne!.phone },
  });

  await createNotification(ctx.admin, {
    institutionId: ctx.institutionId,
    recipientUserId: ctx.userIdByLogin["student.one"]!,
    type: "diary_entry",
    entityId: uuidV5("notifications", `diary-entry:${ananya.id}:homework-math-week`),
    vars: {
      section: "X-A",
      subject: "Mathematics",
      excerpt: "New homework posted: Mathematics Homework: Unit 2 practice set, due this week.",
    },
  });

  const readFeeReminder = await createNotification(ctx.admin, {
    institutionId: ctx.institutionId,
    recipientUserId: ctx.userIdByLogin["guardian.one"]!,
    type: "fee_reminder",
    entityId: uuidV5("notifications", `fee-reminder:${aaravInvoice!.invoice_no}`),
    vars: {
      student: "Aarav Sharma",
      invoice_no: aaravInvoice!.invoice_no,
      amount: String(aaravInvoice!.total),
      due_on: aaravInvoice!.due_on!,
      school: institution!.name,
    },
    contacts: { sms: guardianOne!.phone },
  });

  await createNotification(ctx.admin, {
    institutionId: ctx.institutionId,
    recipientUserId: ctx.userIdByLogin["guardian.two"]!,
    type: "workflow_alert",
    entityId: uuidV5("notifications", "workflow-alert:ptm-slot-open"),
    vars: {
      workflow: "PTM",
      message: "A Parent-Teacher Meeting slot is open for booking on 21 November, 9am-1pm.",
    },
  });

  // Mark 1-2 as read so the portal shows a mix (idempotent: re-running a
  // reset re-applies the same read_at on the same rows).
  const { error: readError } = await ctx.admin
    .from("notifications")
    .update({ read_at: "2026-11-01T09:00:00+05:30" })
    .in("id", [readResults.notificationId, readFeeReminder.notificationId]);
  if (readError) throw readError;
}
