import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";
import { demoUsers, fakeJob, insertOnce, isoAt, sectionRng } from "../lib/util.ts";
import { notifyAnnouncement } from "../../../src/modules/jobs/handlers/notify.announcement.ts";

// Announcements: inserted already published (the update guard only applies to later edits), their
// fan-out to notifications and delivery_attempts is done by the real `notify.announcement`
// handler, so channel statuses (in_app sent, sms/whatsapp simulated, email failed without a
// provider key) are whatever the channel code produces. Only the demo's real login accounts
// receive notifications, so the fan-out is small by design.
// Threads/messages: guardian accounts writing to the class teacher of their child's section.

type Audience = { t: "school" } | { t: "role"; role: string } | { t: "grade"; grade: string } | { t: "section"; section: string };

const ANNOUNCEMENTS: { key: string; title: string; body: string; category: string; day: number; by: "principal" | "admin"; aud: Audience[]; draft?: boolean }[] = [
  { key: "term2-timetable", title: "Term 2 timetable is live", body: "The Term 2 timetable is published in the app. Please check your child's periods and the revised lunch break from Monday.", category: "academic", day: -27, by: "admin", aud: [{ t: "school" }] },
  { key: "diwali-holiday", title: "Diwali holidays", body: "School will remain closed from Thursday to Sunday for Diwali. Classes resume on the following Monday. Wishing every family a safe and bright festival.", category: "holiday", day: -25, by: "principal", aud: [{ t: "school" }] },
  { key: "ptm-saturday", title: "Parent-Teacher Meeting this Saturday", body: "PTM for Grades VI to X is on Saturday, 9 am to 1 pm. Book a slot with your class teacher in the app. Please bring your child's diary.", category: "event", day: -22, by: "admin", aud: [{ t: "role", role: "guardian" }, { t: "role", role: "teacher" }] },
  { key: "fee-due", title: "Term 2 fee due date", body: "Term 2 fees are due this month. Pay online from the Fees page or at the school counter between 9 am and 1 pm. Late fee applies after the grace period.", category: "fees", day: -21, by: "admin", aud: [{ t: "role", role: "guardian" }] },
  { key: "pt2-datesheet-x", title: "Periodic Test 2 date sheet for Grade X", body: "The date sheet for Periodic Test 2 is attached to the Exams page. Students must carry their admit card and a transparent pencil box.", category: "academic", day: -19, by: "principal", aud: [{ t: "grade", grade: "X" }] },
  { key: "science-fair", title: "Annual Science Fair registration", body: "Students of Grades VI to X can register projects with their science teacher by Friday. Group size is up to three students.", category: "event", day: -18, by: "principal", aud: [{ t: "grade", grade: "VI" }, { t: "grade", grade: "VII" }, { t: "grade", grade: "VIII" }, { t: "grade", grade: "IX" }, { t: "grade", grade: "X" }] },
  { key: "staff-meeting", title: "Staff meeting on Monday", body: "All teaching staff to assemble in the library at 3:15 pm for the Term 2 review. Please bring attendance and syllabus completion sheets.", category: "general", day: -17, by: "principal", aud: [{ t: "role", role: "teacher" }] },
  { key: "monsoon-dismissal", title: "Early dismissal due to heavy rain", body: "Because of the weather warning, school will dismiss at 12:30 pm today. Buses will leave at 12:45 pm. Parents collecting children are requested to arrive early.", category: "emergency", day: -15, by: "principal", aud: [{ t: "school" }] },
  { key: "vi-a-trip", title: "Grade VI-A visit to the Science Centre", body: "Section VI-A will visit the city Science Centre next Wednesday. Please return the signed consent slip and Rs 250 by Monday.", category: "event", day: -13, by: "admin", aud: [{ t: "section", section: "VI-A" }] },
  { key: "library-week", title: "Library week and book fair", body: "The book fair runs all week in the school hall. Every student gets a free bookmark and a lucky draw entry with each purchase.", category: "event", day: -11, by: "admin", aud: [{ t: "school" }] },
  { key: "uniform-winter", title: "Winter uniform from 1 December", body: "Winter uniform becomes compulsory from 1 December. Sweaters must be plain navy blue. Uniforms are available at the school store.", category: "general", day: -9, by: "admin", aud: [{ t: "role", role: "guardian" }] },
  { key: "fee-reminder-2", title: "Reminder: fee payment", body: "This is a reminder for families with pending Term 2 fees. Please clear dues to avoid late charges. Contact the accounts office for instalments.", category: "fees", day: -7, by: "admin", aud: [{ t: "role", role: "guardian" }] },
  { key: "viii-b-quiz", title: "Inter-section maths quiz for Grade VIII", body: "The inter-section quiz is on Thursday during periods 5 and 6. Each section sends a team of four. Names to the maths teacher by Tuesday.", category: "event", day: -6, by: "admin", aud: [{ t: "grade", grade: "VIII" }] },
  { key: "x-a-extra", title: "Extra classes for Grade X-A", body: "Extra classes in Mathematics and Science will run from 3:30 to 4:30 pm on Tuesday and Thursday until the pre-board exams.", category: "academic", day: -4, by: "principal", aud: [{ t: "section", section: "X-A" }] },
  { key: "annual-day", title: "Annual Day on 21 November", body: "Parents are invited to the Annual Day function at 10 am in the school hall. Seating is on a first come basis. Performing students report by 8 am.", category: "event", day: -3, by: "principal", aud: [{ t: "school" }] },
  { key: "draft-sports", title: "Sports Day schedule (draft)", body: "Draft schedule of events for Sports Day. House captains to confirm participants before this is published.", category: "event", day: -2, by: "admin", aud: [{ t: "school" }], draft: true },
  { key: "draft-bus", title: "Revised bus routes (draft)", body: "Routes 4 and 7 are merged from next month. Final stop timings to be confirmed by the transport in-charge.", category: "general", day: -1, by: "admin", aud: [{ t: "role", role: "guardian" }], draft: true },
  { key: "draft-pt3", title: "Unit Test 3 syllabus (draft)", body: "Syllabus for Unit Test 3 is being finalised by the subject heads.", category: "academic", day: 0, by: "principal", aud: [{ t: "grade", grade: "IX" }], draft: true },
];

const CONVERSATIONS: { subject: (s: string) => string; lines: { from: "g" | "t"; text: (s: string) => string }[] }[] = [
  { subject: (s) => `${s}'s mathematics homework`, lines: [
    { from: "g", text: (s) => `Good evening. ${s} is finding the latest mathematics practice set difficult. Can you suggest how we can help at home?` },
    { from: "t", text: (s) => `Good evening. ${s} is doing well in class. The trouble is mostly word problems. Ask ${s} to explain each question aloud before solving.` },
    { from: "g", text: () => "Thank you, we will try that this week." },
  ] },
  { subject: (s) => `Leave application for ${s}`, lines: [
    { from: "g", text: (s) => `${s} will be absent on Friday and Saturday for a family wedding. Please accept this as a leave request.` },
    { from: "t", text: (s) => `Noted. I will share the notes and homework for those two days with ${s} on Monday.` },
  ] },
  { subject: (s) => `${s}'s reading progress`, lines: [
    { from: "t", text: (s) => `${s} has been reading well in class. Please encourage 15 minutes of reading at home every day.` },
    { from: "g", text: () => "Thank you ma'am. Can you recommend some books at the right level?" },
    { from: "t", text: () => "Yes, the library has a graded reader list. I will ask the librarian to share it." },
    { from: "g", text: () => "That would be great, thanks." },
  ] },
  { subject: (s) => `Seating and eyesight for ${s}`, lines: [
    { from: "g", text: (s) => `${s} says the board is not clear from the last bench. We are getting the eyes tested this week.` },
    { from: "t", text: (s) => `Thank you for letting me know. I have moved ${s} to the second row for now.` },
  ] },
];

export async function run(ctx: SeedContext): Promise<void> {
  const inst = ctx.institutionId;
  const rng = sectionRng("messaging");
  const users = await demoUsers(ctx.sql, inst);

  const grades = await ctx.sql<{ id: string; code: string }[]>`select id, code from public.grades where institution_id = ${inst}`;
  const sections = await ctx.sql<{ id: string; key: string }[]>`
    select cs.id, g.code || '-' || cs.name as key from public.class_sections cs join public.grades g on g.id = cs.grade_id
    where cs.institution_id = ${inst} and cs.academic_year_id = ${ctx.academicYearId}`;
  const gradeId = new Map(grades.map((g) => [g.code, g.id]));
  const sectionId = new Map(sections.map((s) => [s.key, s.id]));

  const announcementRows = ANNOUNCEMENTS.map((a) => {
    const at = isoAt(a.day, 4, 30 + Math.floor(rng() * 60));
    return {
      id: uuidV5("messaging", `announcement:${a.key}`),
      institution_id: inst,
      title: a.title,
      body: a.body,
      category: a.category,
      status: a.draft ? "draft" : "published",
      published_at: a.draft ? null : at,
      published_by: a.draft ? null : users[a.by]!,
      created_by: users[a.by]!,
      created_at: at,
    };
  });
  await insertOnce(ctx.admin, "announcements", announcementRows);

  const audienceRows = ANNOUNCEMENTS.flatMap((a) =>
    a.aud.map((x, i) => ({
      id: uuidV5("messaging", `audience:${a.key}:${i}`),
      announcement_id: uuidV5("messaging", `announcement:${a.key}`),
      institution_id: inst,
      audience_type: x.t,
      role: x.t === "role" ? x.role : null,
      grade_id: x.t === "grade" ? gradeId.get(x.grade)! : null,
      class_section_id: x.t === "section" ? sectionId.get(x.section)! : null,
    })),
  );
  await insertOnce(ctx.admin, "announcement_audiences", audienceRows);

  for (const a of ANNOUNCEMENTS.filter((x) => !x.draft)) {
    const id = uuidV5("messaging", `announcement:${a.key}`);
    try {
      await notifyAnnouncement(fakeJob("notify.announcement", inst, { announcement_id: id }, `announcement:${id}`), { admin: ctx.admin });
    } catch (err) {
      // Known app limit: a grade audience (~250 students) overflows PostgREST's URI in the handler's `.in("student_id", ...)`.
      const message = err instanceof Error ? err.message : JSON.stringify(err);
      console.warn(`  messaging: fan-out skipped for "${a.key}": ${message.trim()}`);
    }
  }

  // ---- threads and messages ----
  const pairs = await ctx.sql<{ guardian_user: string; guardian_id: string; student_id: string; first_name: string; teacher_user: string; teacher_staff: string }[]>`
    select gm.user_id as guardian_user, gm.guardian_id, st.id as student_id, st.first_name, tm.user_id as teacher_user, tm.staff_id as teacher_staff
    from public.memberships gm
    join public.guardian_students gs on gs.guardian_id = gm.guardian_id
    join public.students st on st.id = gs.student_id
    join public.enrolments e on e.student_id = st.id and e.status = 'active'
    join public.class_sections cs on cs.id = e.class_section_id
    join public.memberships tm on tm.staff_id = cs.class_teacher_id and tm.role = 'teacher' and tm.institution_id = gm.institution_id
    where gm.institution_id = ${inst} and gm.role = 'guardian' and gm.status = 'active'
    order by gm.user_id, st.id`;

  const threads: Record<string, unknown>[] = [];
  const messages: { id: string; [k: string]: unknown }[] = [];
  let n = 0;
  for (const [pi, p] of pairs.entries()) {
    const count = pi % 2 === 0 ? 3 : 2;
    for (let c = 0; c < count; c++) {
      const conv = CONVERSATIONS[(pi + c) % CONVERSATIONS.length]!;
      const threadId = uuidV5("messaging", `thread:${p.guardian_user}:${p.student_id}:${c}`);
      const startDay = -(28 - ((n * 5) % 26));
      const minute = 8 * 60 + ((n * 37) % 360);
      let lastAt = "";
      conv.lines.forEach((line, li) => {
        const at = isoAt(startDay + Math.floor(li / 2), 0, minute + li * 95);
        lastAt = at;
        messages.push({
          id: uuidV5("messaging", `message:${threadId}:${li}`),
          institution_id: inst,
          thread_id: threadId,
          sender_profile_id: line.from === "g" ? p.guardian_user : p.teacher_user,
          body: line.text(p.first_name),
          // The newest message of every third thread is still unread by the recipient.
          read_at: n % 3 === 0 && li === conv.lines.length - 1 ? null : new Date(Date.parse(at) + 40 * 60_000).toISOString(),
          created_at: at,
        });
      });
      threads.push({
        id: threadId,
        institution_id: inst,
        student_id: p.student_id,
        guardian_id: p.guardian_id,
        teacher_staff_id: p.teacher_staff,
        subject: conv.subject(p.first_name),
        last_message_at: lastAt,
        created_by: p.guardian_user,
        created_at: isoAt(startDay, 0, minute),
      });
      n++;
    }
  }
  await insertOnce(ctx.admin, "message_threads", threads as { id: string }[]);
  await insertOnce(ctx.admin, "messages", messages);
}
