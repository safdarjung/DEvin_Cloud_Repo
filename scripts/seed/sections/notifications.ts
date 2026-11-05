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
}
