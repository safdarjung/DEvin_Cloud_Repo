// Orb task bridge — classification of every registered action (design §2).
// A row is a label plus overrides of derive.ts; rule-6 rows are written by hand.
// tests/unit/orb-task-catalog.test.ts fails on any registered action that has
// no row, no exclusion and is not in the frozen UNCLASSIFIED list.
import type { ClassifiedRow, ExcludedRow, TaskRow } from "./types";

const t = (label: string, over: Omit<ClassifiedRow, "label"> = {}): ClassifiedRow => ({ label, ...over });
const x = (excluded: string): ExcludedRow => ({ excluded });

const OWN_CONTROLS = "the orb's own controls";
const AI_DECIDES = "AI approving AI or automation";
const BULK = "destructive or bulk structural";
const UI_STATE = "UI state";
const OWN_ANSWERS = "the person's own answers (integrity)";
const RULE6_LATER = "rule 6: slice 2";

/** Design §8 first slice, in the design's order. */
export const FIRST_SLICE: readonly string[] = [
  // teacher
  "attendance.mark", "attendance.markPeriod", "attendance.submit", "diary.entry.post", "assignment.create", "assignment.update",
  "assignment.publish", "curriculum.lessonPlan.upsert", "questionBank.create", "exam.remark.save", "people.leave.request",
  "messaging.startThread", "messaging.send", "schoolLabs.booking.book", "ptm.slots.add",
  // leadership
  "people.leave.approve", "people.leave.reject", "studentLeave.approve", "studentLeave.reject", "timetable.substitution.assign",
  "announcement.create", "announcement.publish", "calendar.event.upsert", "ptm.event.create", "website.notice.upsert",
  "form.create", "form.publish", "helpdesk.message.reply", "helpdesk.ticket.update",
  "maintenance.assign", "compliance.item.create", "insight.resolve", "insight.dismiss",
  "clubs.event.create", "achievement.record",
  // accountant
  "finance.reminders.send", "expenses.record",
  // admissions
  "admissions.enquiry.status", "admissions.enquiry.note", "admissions.enquiry.assign",
  // office
  "library.loan.issue", "library.loan.renew", "visitors.checkIn", "visitors.checkOut", "visitors.gatePass.create",
  // guardian
  "studentLeave.request", "ptm.booking.create",
  // student
  "study.plan.save", "clubs.join", "helpdesk.ticket.raise",
];

export const TASK_CATALOG: Readonly<Record<string, TaskRow>> = {
  // ── first slice: teacher ──
  "attendance.mark": t("Mark the attendance register", {
    renderer: "attendance.register", href: "/attendance", done: "Marked {classSectionId} for {date}: {recordCount} students",
  }),
  "attendance.markPeriod": t("Mark period attendance", { renderer: "attendance.register", href: "/attendance" }),
  // sessionId comes from the register card it follows (design §3 multi-step).
  "attendance.submit": t("Submit the attendance register", { entities: { "/sessionId": "context" }, href: "/attendance" }),
  "diary.entry.post": t("Post a diary entry", { undo: "diary.entry.delete" }),
  "assignment.create": t("Create an assignment", { generated: ["/aiGenerated"] }),
  "assignment.update": t("Edit an assignment", { generated: ["/aiGenerated"] }),
  "assignment.publish": t("Publish an assignment"),
  "curriculum.lessonPlan.upsert": t("Write a lesson plan", { entities: { "/id": "lessonPlan" } }),
  "questionBank.create": t("Add a question to the bank"),
  "exam.remark.save": t("Write a report-card remark"),
  // staff_attendance and facilities have no orb group in MODULE_GROUP (they fall to "more").
  "people.leave.request": t("Request staff leave", { groupId: "people", undo: "people.leave.cancel" }),
  "messaging.startThread": t("Message a parent or teacher"),
  // One-to-one, like startThread; the "send" verb rule is meant for broadcasts.
  "messaging.send": t("Reply in a message thread", { risk: "user_confirmed" }),
  "schoolLabs.booking.book": t("Book a lab", { undo: "schoolLabs.booking.cancel" }),
  "ptm.slots.add": t("Add PTM meeting slots"),
  // ── first slice: leadership ──
  "people.leave.approve": t("Approve staff leave", { groupId: "people" }),
  "people.leave.reject": t("Reject staff leave", { groupId: "people" }),
  "studentLeave.approve": t("Approve student leave", { href: "/dashboard" }),
  "studentLeave.reject": t("Reject student leave", { href: "/dashboard" }),
  "timetable.substitution.assign": t("Assign a substitute teacher", { undo: "timetable.substitution.cancel", href: "/staff" }),
  // Announcements have no page of their own; they reach people as notifications.
  "announcement.create": t("Draft an announcement", { href: "/notifications" }),
  "announcement.publish": t("Publish an announcement", { href: "/notifications" }),
  "calendar.event.upsert": t("Add a calendar event", { entities: { "/id": "calendar.event" } }),
  "ptm.event.create": t("Create a PTM event", { mode: "create" }),
  "website.notice.upsert": t("Post a website notice", { entities: { "/id": "website.notice" } }),
  "form.create": t("Create a form"),
  "form.publish": t("Publish a form"),
  "helpdesk.message.reply": t("Reply to a helpdesk ticket"),
  "helpdesk.ticket.update": t("Update a helpdesk ticket"),
  "maintenance.assign": t("Assign a maintenance request", { groupId: "operations", href: "/fabric/operations" }),
  "compliance.item.create": t("Add a compliance item", { mode: "create" }),
  "insight.resolve": t("Resolve an insight"),
  "insight.dismiss": t("Dismiss an insight"),
  "clubs.event.create": t("Create a club event"),
  "achievement.record": t("Record a student achievement"),
  // ── first slice: accountant ──
  "finance.reminders.send": t("Send fee reminders for a term", { href: "/finance" }),
  // Money out of the school: the person types the amount (rule 6).
  "expenses.record": t("Record an expense", { family: "money", humanOnly: ["/amount"] }),
  // ── first slice: admissions ──
  "admissions.enquiry.status": t("Move an enquiry to a new stage"),
  "admissions.enquiry.note": t("Add a note to an enquiry"),
  "admissions.enquiry.assign": t("Assign an enquiry to a staff member"),
  // ── first slice: office ──
  "library.loan.issue": t("Issue a library book", {
    requireOneOf: [["/studentId", "/staffId"]], done: "Issued {accessionNo} to {studentId}{staffId}, due {dueOn}",
  }),
  "library.loan.renew": t("Renew a library loan"),
  "visitors.checkIn": t("Check in a visitor", { requireOneOf: [["/hostStaffId", "/meetingWith"]] }),
  "visitors.checkOut": t("Check out a visitor", { entities: { "/id": "visitors.visit" } }),
  // Releases a child to a named person: always a checked card, never batched.
  "visitors.gatePass.create": t("Issue a student gate pass", { risk: "human_approved", requireOneOf: [["/guardianId", "/pickupPersonId"]] }),
  // ── first slice: guardian ──
  "studentLeave.request": t("Request leave for a student", { undo: "studentLeave.cancel", href: "/portal/leave" }),
  "ptm.booking.create": t("Book a PTM slot", { undo: "ptm.booking.cancel", href: "/portal/meetings" }),
  // ── first slice: student ──
  "study.plan.save": t("Save a study plan", { href: "/portal/study" }),
  "clubs.join": t("Join a club", { undo: "clubs.leave", href: "/portal/clubs" }),
  "helpdesk.ticket.raise": t("Raise a helpdesk ticket"),

  // ── undo targets of the first slice ──
  "diary.entry.delete": t("Delete a diary entry"),
  "people.leave.cancel": t("Cancel a staff leave request", { groupId: "people" }),
  "schoolLabs.booking.cancel": t("Cancel a lab booking"),
  "timetable.substitution.cancel": t("Cancel a substitution", { href: "/staff" }),
  "studentLeave.cancel": t("Cancel a student leave request", { href: "/portal/leave" }),
  "ptm.booking.cancel": t("Cancel a PTM booking", { href: "/portal/meetings" }),
  "clubs.leave": t("Leave a club"),

  // ── excluded (design §2) ──
  "core.module.set": x(OWN_CONTROLS),
  "core.feature.set": x(OWN_CONTROLS),
  "core.ai_role.set": x(OWN_CONTROLS),
  "core.institution.updateSettings": x(OWN_CONTROLS),
  "workflow.run.decide": x(AI_DECIDES),
  "workflow.setStatus": x(AI_DECIDES),
  "workflow.runNow": x(AI_DECIDES),
  "studio.request.decide": x(AI_DECIDES),
  "visitors.purge": x(BULK),
  "alumni.sync": x(BULK),
  "compliance.starter.load": x(BULK),
  "core.setup.applyTemplate": x(BULK),
  "lifecycle.promote": x(BULK),
  "job.requeue": x(BULK),
  "notification.read": x(UI_STATE),
  "messaging.markRead": x(UI_STATE),
  "core.setup.setProgress": x(UI_STATE),
  "study.quiz.submit": x(OWN_ANSWERS),
  "study.deck.review": x(OWN_ANSWERS),
  "practice.submitAttempt": x(OWN_ANSWERS),
  "assignment.submit": x(OWN_ANSWERS),
  "survey.respond": x(OWN_ANSWERS),
  "form.respond": x(OWN_ANSWERS),
  "safety.alert.send": x("stays a page button"),
  "finance.payment.createIntent": x("needs the payment gateway UI"),
  "briefing.generate": x("AI generation; belongs in Ask"),
  "insight.explain": x("AI generation; belongs in Ask"),

  // ── rule 6 (marks, money, access, welfare): excluded until slice 2 hosts the existing forms (design §9.1) ──
  "admissions.application.decide": x(RULE6_LATER),
  "assignment.grade": x(RULE6_LATER),
  "behaviour.incident.log": x(RULE6_LATER),
  "behaviour.incident.void": x(RULE6_LATER),
  "canteen.purchase": x(RULE6_LATER),
  "canteen.topup": x(RULE6_LATER),
  "duty.roster.generate": x(RULE6_LATER),
  "duty.swap.cancel": x(RULE6_LATER),
  "duty.swap.request": x(RULE6_LATER),
  "duty.swap.respond": x(RULE6_LATER),
  "exam.marks.enter": x(RULE6_LATER),
  "exam.recheck.decide": x(RULE6_LATER),
  "exam.result.publish": x(RULE6_LATER),
  "finance.payment.record": x(RULE6_LATER),
  "finance.payment.void": x(RULE6_LATER),
  "health.profile.save": x(RULE6_LATER),
  "health.vaccination.add": x(RULE6_LATER),
  "health.visit.add": x(RULE6_LATER),
  "hostel.allocate": x(RULE6_LATER),
  "library.loan.return": x(RULE6_LATER),
  "lifecycle.transfer": x(RULE6_LATER),
  "lifecycle.withdraw": x(RULE6_LATER),
  "payroll.run.finalize": x(RULE6_LATER),
  "payroll.run.generate": x(RULE6_LATER),
  "payroll.structure.save": x(RULE6_LATER),
  "safety.alert.acknowledge": x(RULE6_LATER),
  "safety.alert.close": x(RULE6_LATER),
  "safety.alert.preview": x(RULE6_LATER),
  "safety.headcount.mark": x(RULE6_LATER),
  "scholarships.award.decide": x(RULE6_LATER),
};

/** Whole name families the design excludes; new actions in them are excluded without a row. */
export const EXCLUDED_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/^agent\./, AI_DECIDES],
  [/^core\.member\./, "access: slice 2 at the earliest"],
  [/^data\.import\./, BULK],
  [/\.(requestUpload|confirmUpload|readUrl|getReadUrl)$/, "upload and download plumbing"],
  [/^core\.dashboard\.layout\./, UI_STATE],
  [/^ai\.study\./, "the study chat's own saves"],
  [/^ai\.proposal\./, OWN_CONTROLS],
];

/** The row for a registered action: its own row, else an excluded family, else undefined (unclassified). */
export function catalogRow(name: string): TaskRow | undefined {
  if (Object.hasOwn(TASK_CATALOG, name)) return TASK_CATALOG[name];
  const hit = EXCLUDED_PATTERNS.find(([re]) => re.test(name));
  return hit ? x(hit[1]) : undefined;
}

/** Registered actions not yet classified. Frozen: it may only shrink; a new action must get a row. */
export const UNCLASSIFIED: readonly string[] = Object.freeze([
  "academics.grade.upsert", "academics.section.upsert", "academics.subject.upsert", "academics.subjectAssignment.set",
  "achievement.verify", "achievement.void", "admissions.enquiry.convert", "admissions.enrol", "alumni.profile.update",
  "attendance.correct", "calendar.event.delete", "canteen.item.create", "canteen.item.update", "certificate.issue", "clubs.create",
  "clubs.event.cancel", "clubs.event.cancelSignup", "clubs.event.signUp", "clubs.house.assign", "clubs.house.awardPoints",
  "clubs.house.create", "clubs.house.unassign", "clubs.update", "compliance.item.delete", "compliance.item.renew",
  "compliance.item.update", "core.academicYear.upsert", "core.setup.saveBranding", "core.term.upsert", "curriculum.lessonPlan.delete",
  "curriculum.markCovered", "curriculum.material.attach", "curriculum.material.delete", "curriculum.material.review",
  "curriculum.material.suggest", "curriculum.unit.upsert", "diary.acknowledge", "document.delete", "duty.assignment.set",
  "duty.type.create", "duty.type.update", "exam.create", "exam.marks_entry.close", "exam.marks_entry.open", "exam.marks_entry.reopen",
  "exam.paper.schedule", "exam.paper.setUnits", "exam.papers.create", "exam.recheck.request", "exam.recheck.review", "exam.verify",
  "examSeating.generate", "expenses.budget.set", "expenses.category.create", "expenses.category.update", "expenses.void",
  "fabric.simulator.create", "fabric.simulator.decide", "fabric.simulator.delete", "fabric.simulator.update", "facilities.asset.upsert",
  "feePlans.instalments.set", "feePlans.lateFeeRule.upsert", "finance.invoice.generateBulk", "finance.invoice.generateStudent",
  "finance.invoice.generateTerm", "finance.reminders.sendSelected", "finance.structure.assign", "finance.structure.upsert", "form.close",
  "form.update", "helpdesk.message.add", "hostel.rollCall.save", "hostel.room.create", "hostel.room.update", "hostel.vacate",
  "insight.action", "insight.review", "inventory.item.create", "inventory.item.update", "inventory.movement.record", "library.book.upsert",
  "library.copies.add", "library.copy.setStatus", "maintenance.close", "maintenance.request", "mastery.intervention.update",
  "notification.preferences.set", "people.department.upsert", "people.guardian.link", "people.guardian.update", "people.staff.upsert",
  "people.staffAttendance.checkIn", "people.staffAttendance.mark", "people.student.update", "ptm.event.publish", "ptm.slot.remove",
  "questionBank.archive", "questionBank.update", "report.schedule.save", "report.schedule.setStatus", "resource.attachFile",
  "resource.create", "resource.delete", "resource.publish", "scholarships.award.request", "scholarships.rule.save",
  "scholarships.rule.setActive", "schoolLabs.equipment.create", "schoolLabs.equipment.update", "schoolLabs.experiment.complete",
  "schoolLabs.experiment.log", "schoolLabs.incident.record", "schoolLabs.lab.create", "schoolLabs.lab.update", "studio.request.propose",
  "studio.request.submit", "study.fileConsent.give", "study.material.delete", "study.material.save", "study.material.saveVariant",
  "study.mock.save", "study.plan.toggleItem", "study.question.answer", "study.question.ask", "study.scope.logTime", "study.scope.open",
  "study.scope.saveMessages", "study.session.log", "study.teacher.assign", "study.teacher.fileConsent.give",
  "study.teacher.material.delete", "study.teacher.material.save", "study.teacher.material.saveVariant", "study.teacher.worksheet.save",
  "survey.close", "survey.create", "textbook.add", "textbook.chapterTitles.set", "textbook.file.remove", "textbook.link.set",
  "textbook.remove", "textbook.suggestNcert", "textbook.unitChapter.set", "timetable.change.apply", "timetable.change.rollback",
  "timetable.period.upsert", "timetable.publish", "timetable.room.upsert", "timetable.rules.set", "timetable.saveDraft",
  "timetable.snapshot.create", "timetable.snapshot.restore", "timetable.version.create", "transport.assign", "transport.route.upsert",
  "transport.stop.upsert", "transport.unassign", "transport.vehicle.upsert", "visitors.gatePass.setStatus", "visitors.pickup.add",
  "visitors.pickup.remove", "website.event.upsert", "website.live_set", "website.page.create", "website.page.publish",
  "website.page.save_version", "website.theme.save", "workflow.save",
]);
