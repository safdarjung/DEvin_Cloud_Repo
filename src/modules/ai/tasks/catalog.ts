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
const RULE6 = "rule 6: human-only (slice 2)";
const DESTRUCTIVE = "destructive: delete, remove and void stay page actions";
const SETTINGS = "settings and toggles stay on their pages (design §7)";
const AUTOMATION = "automation definitions stay in their builders";
const STUDY_SAVES = "the study studio's own saves";
const OWN_CONSENT = "the person's own consent";
const PAPER_EDITOR = "question papers are built in the paper editor";
// An upsert whose "/id" is "context" is create-only: the id is never taken from the model or the card,
// so the card can never overwrite an existing record with fields the person did not see.
const CREATE_ONLY = { "/id": "context" } as const;

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
  "maintenance.assign", "compliance.item.create", "insight.resolve", "insight.dismiss", "insight.action", "insight.review",
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
  // 0146/0147 fields beyond the basics are page-only, never taken from the model. origin is forced to
  // "ai" at approval (proposals.ts), so orb questions land as drafts for review.
  "questionBank.create": t("Add a question to the bank", {
    entities: { "/curriculumTopicId": "context", "/sourceSubjectTextbookId": "context", "/stemQuestionId": "context" },
    generated: ["/origin", "/aiModel", "/markingScheme", "/learningOutcome", "/sourceChapterNo", "/sourcePage"],
  }),
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

  // ── staff daily work (teacher and every staff role that holds the permission) ──
  // facilities has no orb group in MODULE_GROUP; its requests live on the operations board, like maintenance.assign.
  "maintenance.request": t("Report a maintenance issue", { groupId: "operations", href: "/fabric/operations" }),
  "maintenance.close": t("Close a maintenance request", { groupId: "operations", href: "/fabric/operations" }),
  "people.staffAttendance.checkIn": t("Check in for today", { groupId: "people" }),
  "helpdesk.message.add": t("Add a message to a helpdesk ticket"),
  "questionBank.archive": t("Archive or restore a question", { entities: { "/id": "question" } }),
  "questionBank.setPracticeAllowed": t("Keep a question in or out of student practice", { entities: { "/id": "question" } }),
  "clubs.event.signUp": t("Sign up for a club event", { undo: "clubs.event.cancelSignup", href: "/portal/clubs" }),
  "clubs.event.cancelSignup": t("Cancel a club event sign-up", { href: "/portal/clubs" }),
  // Families acknowledge; staff hold the permission but have nothing to acknowledge.
  "diary.acknowledge": t("Acknowledge a diary entry", { defaultOn: ["student", "guardian"], href: "/portal/updates" }),

  // ── front office and admin ──
  // Off for the admissions role: the only grade picker is gated on finance.read, which it lacks. Turn on once a grade query it can read exists.
  "admissions.enquiry.convert": t("Turn an enquiry into an application", { defaultOn: ["owner", "principal", "admin"] }),
  "transport.assign": t("Assign a student to a bus stop", { groupId: "operations", undo: "transport.unassign" }),
  "transport.unassign": t("Take a student off school transport", { groupId: "operations" }),
  "transport.route.upsert": t("Add a bus route", { mode: "manage", groupId: "operations", entities: CREATE_ONLY }),
  "transport.vehicle.upsert": t("Add a school vehicle", { mode: "manage", groupId: "operations", entities: CREATE_ONLY }),
  "library.book.upsert": t("Add a book to the library catalogue", { entities: CREATE_ONLY }),
  "inventory.item.create": t("Add a stock item"),
  "inventory.item.update": t("Edit a stock item", { entities: { "/id": "inventory.item" } }),
  "inventory.movement.record": t("Record a stock movement"),
  "clubs.create": t("Start a new club"),
  "clubs.update": t("Edit a club", { entities: { "/id": "clubs.club" } }),
  // Drops every sign-up of the event: a checked card.
  "clubs.event.cancel": t("Cancel a club event", { risk: "human_approved", entities: { "/id": "clubs.event" } }),
  "clubs.house.create": t("Add a house", { mode: "manage" }),
  "clubs.house.assign": t("Put a student in a house", { undo: "clubs.house.unassign" }),
  "clubs.house.unassign": t("Take a student out of their house"),
  // The renewal document is uploaded on the compliance page, not attached from the card.
  "compliance.item.renew": t("Record a compliance renewal", { entities: { "/documentId": "context" } }),
  "form.close": t("Close a form"),
  "ptm.event.publish": t("Publish a PTM event"),
  "survey.close": t("Close a survey"),
  "website.page.create": t("Create a website page"),
  "website.event.upsert": t("Add a website event", { entities: CREATE_ONLY }),
  "hostel.room.create": t("Add a hostel room"),
  "hostel.room.update": t("Edit a hostel room", { entities: { "/id": "hostel.room" } }),
  "schoolLabs.lab.create": t("Add a lab", { mode: "manage" }),
  "schoolLabs.lab.update": t("Edit a lab", { mode: "manage", entities: { "/id": "schoolLabs.lab" } }),
  "schoolLabs.equipment.create": t("Add lab equipment"),
  "people.student.update": t("Update a student's details"),
  "people.department.upsert": t("Add a department", { entities: CREATE_ONLY }),
  "academics.grade.upsert": t("Add a grade", { entities: CREATE_ONLY }),
  // The class teacher reads and marks the section's roster (access): the person picks them.
  "academics.section.upsert": t("Add a class section", { family: "access", humanOnly: ["/classTeacherId"], entities: CREATE_ONLY }),
  "academics.subject.upsert": t("Add a subject", { entities: CREATE_ONLY }),
  "curriculum.unit.upsert": t("Add a curriculum unit", { mode: "manage", groupId: "teaching", entities: CREATE_ONLY }),
  // Switching the current year moves the whole school: the person sets it.
  "core.academicYear.upsert": t("Add an academic year", { humanOnly: ["/isCurrent"], entities: CREATE_ONLY }),
  "core.term.upsert": t("Add a term", { entities: CREATE_ONLY }),
  "insight.action": t("Record an action on an insight"),
  "insight.review": t("Mark an insight as reviewed"),
  "achievement.verify": t("Verify a student achievement"),
  "duty.type.create": t("Add a duty type"),
  "duty.type.update": t("Edit a duty type", { entities: { "/id": "duty.type" } }),
  // Releases or holds a child at the gate: always a checked card, never batched.
  // Whether a child may leave is a welfare decision: the person picks the status, never the model.
  "visitors.gatePass.setStatus": t("Approve or reject a gate pass", { risk: "human_approved", family: "welfare", humanOnly: ["/status"], entities: { "/id": "visitors.gatePass" } }),

  // ── accountant set-up (no money moves; every amount is typed by the person) ──
  "expenses.category.create": t("Add an expense category"),
  "expenses.category.update": t("Edit an expense category", { entities: { "/id": "expenses.category" } }),
  "expenses.budget.set": t("Set an expense budget", { family: "money", humanOnly: ["/amount"] }),
  "canteen.item.create": t("Add a canteen item", { family: "money", humanOnly: ["/pricePaise"] }),
  "canteen.item.update": t("Edit a canteen item", { family: "money", humanOnly: ["/pricePaise"], entities: { "/id": "canteen.item" } }),
  "scholarships.rule.save": t("Add a scholarship rule", { family: "money", humanOnly: ["/percent", "/amountPaise"], entities: CREATE_ONLY }),
  "scholarships.rule.setActive": t("Turn a scholarship rule on or off", { entities: { "/id": "scholarships.rule" } }),
  // A request only; scholarships.award.decide (the money decision) stays excluded.
  "scholarships.award.request": t("Request a scholarship for a student"),
  "feePlans.lateFeeRule.upsert": t("Set a late-fee rule", { groupId: "finance", family: "money", humanOnly: ["/amount", "/cap"] }),
  "finance.structure.upsert": t("Add a fee structure", { family: "money", humanOnly: ["/components/*/amount"], entities: CREATE_ONLY }),
  "finance.structure.assign": t("Assign a fee structure to a student", { family: "money", humanOnly: ["/concessions/*/percent", "/concessions/*/amount"] }),

  // ── exam controller ──
  "exam.create": t("Create an exam"),
  "exam.marks_entry.open": t("Open marks entry for an exam"),
  "exam.marks_due.set": t("Set the date marks are due for an exam"),
  "exam.marks_entry.close": t("Close marks entry for an exam"),
  "exam.marks_entry.reopen": t("Reopen marks entry for an exam"),
  "exam.recheck.review": t("Start reviewing a recheck request"),
  // Maximum and pass marks are typed by the person (rule 6).
  "exam.papers.create": t("Add papers to an exam", { family: "marks", humanOnly: ["/papers/*/maxMarks", "/papers/*/passMarks"] }),

  // ── excluded (design §2) ──
  "core.module.set": x(OWN_CONTROLS),
  "core.feature.set": x(OWN_CONTROLS),
  "core.ai_role.set": x(OWN_CONTROLS),
  "core.institution.updateSettings": x(OWN_CONTROLS),
  "workflow.run.decide": x(AI_DECIDES),
  "workflow.setStatus": x(AI_DECIDES),
  "workflow.runNow": x(AI_DECIDES),
  "studio.request.decide": x(AI_DECIDES),
  // rule 6: review of AI-written questions is a person's decision.
  "questionBank.approve": x(AI_DECIDES),
  "questionBank.reject": x(AI_DECIDES),
  "questionBank.import": x(BULK),
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
  "practice.submitSession": x(OWN_ANSWERS),
  "assignment.submit": x(OWN_ANSWERS),
  "survey.respond": x(OWN_ANSWERS),
  "form.respond": x(OWN_ANSWERS),
  "safety.alert.send": x("stays a page button"),
  "finance.payment.createIntent": x("needs the payment gateway UI"),
  "people.student.search": x("type-ahead lookup behind the student pickers"),
  "core.practice.run": x("demo practice data stays a tour button"),
  "briefing.generate": x("AI generation; belongs in Ask"),
  "insight.explain": x("AI generation; belongs in Ask"),

  // ── rule 6 (marks, money, access, welfare): excluded until slice 2 hosts the existing forms (design §9.1) ──
  "admissions.application.decide": x(RULE6_LATER),
  "admissions.application.start_review": x(RULE6_LATER),
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
  // Access: enrolling creates the student and their fees; a guardian link opens the child's records; teaching assignments decide what a teacher reads and marks.
  "admissions.enrol": x(RULE6),
  "people.guardian.link": x(RULE6),
  "academics.subjectAssignment.set": x(RULE6),
  // Money owed by families: invoices and instalments; voiding an expense.
  "finance.invoice.generateBulk": x(RULE6),
  "finance.invoice.generateStudent": x(RULE6),
  "finance.invoice.generateTerm": x(RULE6),
  "feePlans.instalments.set": x(RULE6),
  "expenses.void": x(RULE6),
  // Marks: verifying an exam signs off its marks.
  "exam.verify": x(RULE6),
  // Welfare and discipline: conduct on certificates, house points, hostel places, who may collect a child.
  "certificate.issue": x(RULE6),
  "clubs.house.awardPoints": x(RULE6),
  "hostel.vacate": x(RULE6),
  "visitors.pickup.add": x(RULE6),
  "visitors.pickup.remove": x(RULE6),

  // ── destructive, settings, automation and the study studio's own saves ──
  "achievement.void": x(DESTRUCTIVE),
  "calendar.event.delete": x(DESTRUCTIVE),
  "compliance.item.delete": x(DESTRUCTIVE),
  "curriculum.lessonPlan.delete": x(DESTRUCTIVE),
  "curriculum.material.delete": x(DESTRUCTIVE),
  "curriculum.topic.delete": x(DESTRUCTIVE),
  "questionCollection.delete": x(DESTRUCTIVE),
  "questionCollection.removeItems": x(DESTRUCTIVE),
  "document.delete": x(DESTRUCTIVE),
  "fabric.simulator.delete": x(DESTRUCTIVE),
  "ptm.slot.remove": x(DESTRUCTIVE),
  "resource.delete": x(DESTRUCTIVE),
  "study.material.delete": x(DESTRUCTIVE),
  "study.teacher.material.delete": x(DESTRUCTIVE),
  "textbook.file.remove": x(DESTRUCTIVE),
  "textbook.remove": x(DESTRUCTIVE),
  "examSeating.generate": x(BULK),
  "core.setup.saveBranding": x(SETTINGS),
  "core.settings.saveSchoolName": x(SETTINGS),
  "people.qualificationRules.save": x(SETTINGS),
  "people.teacherProfile.saveOwn": x(OWN_ANSWERS),
  "notification.preferences.set": x(SETTINGS),
  "report.schedule.setStatus": x(SETTINGS),
  "website.live_set": x(SETTINGS),
  "website.theme.save": x(SETTINGS),
  "report.schedule.save": x(AUTOMATION),
  "workflow.save": x(AUTOMATION),
  "resource.attachFile": x("upload and download plumbing"),
  // 0148: reading a book's PDF (and its OCR, which spends the school's AI quota) runs from the book's page.
  "content.extraction.start": x("textbook reading runs from the book's page"),
  "content.extraction.retry": x("textbook reading runs from the book's page"),
  "content.extraction.ocr": x("textbook reading runs from the book's page"),
  "content.chunk.update": x("textbook reading runs from the book's page"),
  // 0149: the paper builder (sections, items, templates, review) stays in its editor; approval and publish are human decisions.
  "questionPapers.create": x(PAPER_EDITOR),
  "questionPapers.update": x(PAPER_EDITOR),
  "questionPapers.section.add": x(PAPER_EDITOR),
  "questionPapers.section.update": x(PAPER_EDITOR),
  "questionPapers.section.reorder": x(PAPER_EDITOR),
  "questionPapers.item.addFromBank": x(PAPER_EDITOR),
  "questionPapers.item.addManual": x(PAPER_EDITOR),
  "questionPapers.item.update": x(PAPER_EDITOR),
  "questionPapers.item.reorder": x(PAPER_EDITOR),
  "questionPapers.item.setChoiceGroup": x(PAPER_EDITOR),
  "questionPapers.item.replace": x(PAPER_EDITOR),
  "questionPapers.template.save": x(PAPER_EDITOR),
  "questionPapers.template.apply": x(PAPER_EDITOR),
  "questionPapers.generate": x(PAPER_EDITOR),
  "questionPapers.submitForReview": x(PAPER_EDITOR),
  "questionPapers.returnToDraft": x(PAPER_EDITOR),
  "questionPapers.newRevision": x(PAPER_EDITOR),
  "questionPapers.duplicate": x(PAPER_EDITOR),
  "questionPapers.approve": x(AI_DECIDES),
  "questionPapers.publish": x(AI_DECIDES),
  "questionPapers.section.remove": x(DESTRUCTIVE),
  "questionPapers.item.remove": x(DESTRUCTIVE),
  "questionPapers.archive": x(DESTRUCTIVE),
  // Online test marks are a human's (rule 6): AI only suggests, inside the marking page.
  "onlineTests.marking.save": x(RULE6),
  "onlineTests.marking.suggest": x(RULE6),
  "onlineTests.attempt.finalise": x(RULE6),
  "onlineTests.results.publish": x(RULE6),
  "onlineTests.marks.pushToEntry": x(RULE6),
  "study.plan.toggleItem": x(UI_STATE),
  "study.fileConsent.give": x(OWN_CONSENT),
  "study.teacher.fileConsent.give": x(OWN_CONSENT),
  "study.material.save": x(STUDY_SAVES),
  "study.material.saveVariant": x(STUDY_SAVES),
  "study.mock.save": x(STUDY_SAVES),
  "study.scope.logTime": x(STUDY_SAVES),
  "study.scope.open": x(STUDY_SAVES),
  "study.scope.saveMessages": x(STUDY_SAVES),
  "study.teacher.material.save": x(STUDY_SAVES),
  "study.teacher.material.saveVariant": x(STUDY_SAVES),
  "study.teacher.worksheet.save": x(STUDY_SAVES),
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
  [/^ai\.orb\./, "the orb's own saved chats and notes"],
];

/** The row for a registered action: its own row, else an excluded family, else undefined (unclassified). */
export function catalogRow(name: string): TaskRow | undefined {
  if (Object.hasOwn(TASK_CATALOG, name)) return TASK_CATALOG[name];
  const hit = EXCLUDED_PATTERNS.find(([re]) => re.test(name));
  return hit ? x(hit[1]) : undefined;
}

/** Registered actions not yet classified. Frozen: it may only shrink; a new action must get a row. */
export const UNCLASSIFIED: readonly string[] = Object.freeze([
  "alumni.profile.update", "attendance.correct", "compliance.item.update", "curriculum.markCovered", "curriculum.material.attach",
  "curriculum.material.review", "curriculum.material.suggest", "curriculum.topic.upsert", "duty.assignment.set",
  "exam.paper.schedule", "exam.paper.setUnits", "exam.recheck.request", "fabric.simulator.create", "fabric.simulator.decide",
  "fabric.simulator.update", "facilities.asset.upsert", "finance.reminders.sendSelected", "form.update", "hostel.rollCall.save",
  "library.copies.add", "library.copy.setStatus", "mastery.intervention.update", "onlineTests.attempt.saveResponse",
  "onlineTests.attempt.start", "onlineTests.attempt.submit", "onlineTests.cancel", "onlineTests.close", "onlineTests.create",
  "onlineTests.schedule", "onlineTests.update", "people.guardian.update", "people.staff.upsert", "people.staffAttendance.mark",
  "practice.startBank", "questionBank.duplicate", "questionBank.export", "questionBank.submitForReview", "questionBank.update",
  "questionCollection.addItems", "questionCollection.create", "questionCollection.update", "resource.create", "resource.publish",
  "schoolLabs.equipment.update", "schoolLabs.experiment.complete", "schoolLabs.experiment.log", "schoolLabs.incident.record",
  "studio.request.propose", "studio.request.submit", "study.question.answer", "study.question.ask", "study.session.log",
  "study.teacher.assign", "survey.create", "textbook.add", "textbook.chapterTitles.set", "textbook.link.set",
  "textbook.meta.update", "textbook.suggestNcert", "textbook.unitChapter.set", "timetable.change.apply",
  "timetable.change.rollback", "timetable.period.upsert", "timetable.publish", "timetable.room.upsert", "timetable.rules.set",
  "timetable.saveDraft", "timetable.snapshot.create", "timetable.snapshot.restore", "timetable.version.create",
  "transport.stop.upsert", "website.page.publish", "website.page.save_version",
]);
