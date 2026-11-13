import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Handlers that are reached call createClient() first; with no acting client
// set, this mock throws, so an authorized call ends as `internal` with no side
// effects — the walk never touches a database.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import "@/app/api/v1/actions/all-actions";
import { getRegisteredActions } from "@/lib/actions/registry";
import type { ActionResult } from "@/lib/actions/result";
import { permissionsFor, type Permission, type Role } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import { allModulesOn } from "@/lib/modules/catalog";

// 07 §6 C-03 (T-042): walk the action registry and call every action as
// every role. A role without the action's permission must get `forbidden`; a
// role with it must get past the gate; unknown keys must be `validation_failed`.
const ROLES: Role[] = ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"];
const U = () => crypto.randomUUID();
const at = "2026-10-01T09:00:00.000Z";

// `rolesForbidden` is for the rare action whose own handler has a second,
// role-based (not permission-based) restriction the gate permission can't
// express (e.g. briefing.generate's brief-role map, M25 rulings) — those
// roles are expected `forbidden` past the gate even though they hold the
// listed permission.
const FIXTURES: Record<string, { permission: Permission; input: () => Record<string, unknown>; rolesForbidden?: Role[] }> = {
  "core.feature.set": { permission: "institution.settings.manage", input: () => ({ key: "teacher_ai_agent", enabled: true }) },
  "core.module.set": { permission: "institution.settings.manage", input: () => ({ key: "timetable", enabled: true }) },
  "core.ai_role.set": { permission: "institution.settings.manage", input: () => ({ role: "teacher", patch: { enabled: true } }) },
  "core.setup.applyTemplate": {
    permission: "institution.settings.manage",
    input: () => ({ board: "CBSE", fromGrade: "I", toGrade: "V", sectionsPerGrade: 2 }),
  },
  "core.setup.saveBranding": { permission: "institution.settings.manage", input: () => ({ logoPath: `${U()}/logo.png`, primaryColor: "#1a2b3c" }) },
  "core.setup.setProgress": { permission: "institution.settings.manage", input: () => ({ step: "branding", state: "dismissed" }) },
  "canteen.item.create": { permission: "canteen.manage", input: () => ({ name: "Probe item", pricePaise: 1500 }) },
  "canteen.item.update": { permission: "canteen.manage", input: () => ({ id: U(), pricePaise: 1500 }) },
  "canteen.topup": { permission: "canteen.manage", input: () => ({ studentId: U(), amountPaise: 500 }) },
  "canteen.purchase": { permission: "canteen.manage", input: () => ({ studentId: U(), itemId: U(), quantity: 1 }) },
  "agent.run": { permission: "agent.run", input: () => ({ slug: "finance", task: "x" }) },
  "agent.definition.setEnabled": { permission: "agent.approve", input: () => ({ slug: "finance", enabled: true }) },
  "agent.approve": { permission: "agent.run", input: () => ({ runId: U() }) },
  "agent.reject": { permission: "agent.run", input: () => ({ runId: U() }) },
  "agent.start": { permission: "agent.run", input: () => ({ runId: U() }) },
  "agent.custom.create": {
    permission: "agent.approve",
    input: () => ({ name: "Probe agent", summary: "Probe.", instructions: "Probe.", examples: [], baseSlug: "library", tools: ["library.overdue"], actions: [] }),
  },
  "agent.custom.update": {
    permission: "agent.approve",
    input: () => ({ id: U(), name: "Probe agent", summary: "Probe.", instructions: "Probe.", examples: [], baseSlug: "library", tools: ["library.overdue"], actions: [] }),
  },
  "agent.custom.archive": { permission: "agent.approve", input: () => ({ id: U() }) },
  "core.dashboard.layout.save": { permission: "dashboard.view", input: () => ({ hidden: [], order: [] }) },
  "core.dashboard.layout.reset": { permission: "dashboard.view", input: () => ({}) },
  "ai.orb.chat.save": { permission: "ai.chat", input: () => ({ title: "Probe", messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "Probe" }] }] }) },
  "ai.orb.note.save": { permission: "ai.chat", input: () => ({ title: "Probe", text: "Probe" }) },
  "ai.orb.items.list": { permission: "ai.chat", input: () => ({}) },
  "ai.orb.item.get": { permission: "ai.chat", input: () => ({ itemId: U() }) },
  "ai.orb.item.pin": { permission: "ai.chat", input: () => ({ itemId: U(), pinned: true }) },
  "ai.orb.item.delete": { permission: "ai.chat", input: () => ({ itemId: U() }) },
  "ai.study.chat.save": {
    permission: "ai.study",
    input: () => ({ title: "Probe", messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "Probe" }] }] }),
  },
  "ai.study.note.save": {
    permission: "ai.study",
    input: () => ({ title: "Probe", blocks: [{ kind: "callout", tone: "tip", text: "Probe" }] }),
  },
  "ai.study.item.update": { permission: "ai.study", input: () => ({ itemId: U(), pinned: true }) },
  "ai.study.item.delete": { permission: "ai.study", input: () => ({ itemId: U() }) },
  "ai.study.language.update": { permission: "ai.study", input: () => ({ language: "hi" }) },
  // 0143 orb task bridge. start: the task's own taskState gate runs in the handler, so roles
  // without library.manage (or with AI off by default) are refused there; the rest reach the insert.
  "ai.proposal.start": {
    permission: "ai.chat",
    input: () => ({ action: "library.loan.issue", values: { accessionNo: "ACC-1" } }),
    rolesForbidden: ["admissions", "accountant", "exam_controller", "teacher", "student", "guardian"],
  },
  "ai.proposal.approve": { permission: "ai.chat", input: () => ({ proposalId: U(), values: {} }) },
  "ai.proposal.discard": { permission: "ai.chat", input: () => ({ proposalId: U() }) },
  "ai.proposal.opened": { permission: "ai.chat", input: () => ({ proposalId: U() }) },
  "job.requeue": { permission: "job.manage", input: () => ({ jobId: U() }) },
  "library.book.upsert": { permission: "library.manage", input: () => ({ title: "Probe", author: "Probe" }) },
  "library.copies.add": { permission: "library.manage", input: () => ({ bookId: U(), accessionNos: ["LIB-PROBE"] }) },
  "library.copy.setStatus": { permission: "library.manage", input: () => ({ copyId: U(), status: "withdrawn" }) },
  "library.loan.issue": { permission: "library.manage", input: () => ({ accessionNo: "LIB-0001", studentId: U() }) },
  "library.loan.renew": { permission: "library.manage", input: () => ({ accessionNo: "LIB-0001" }) },
  "library.loan.return": { permission: "library.manage", input: () => ({ accessionNo: "LIB-0001" }) },
  "lifecycle.promote": {
    permission: "academics.manage",
    input: () => ({ fromYearId: U(), toYearId: U(), mappings: [{ fromSectionId: U(), toSectionId: U() }] }),
  },
  "lifecycle.transfer": {
    permission: "student.write",
    input: () => ({ studentId: U(), reason: "Probe reason text.", destinationSchool: "Probe School" }),
  },
  "lifecycle.withdraw": {
    permission: "student.write",
    input: () => ({ studentId: U(), reason: "Probe reason text." }),
  },
  "exam.create": { permission: "exam.manage", input: () => ({ termId: U(), name: "Probe", type: "unit_test" }) },
  "exam.papers.create": {
    permission: "exam.manage",
    input: () => ({ examId: U(), papers: [{ classSectionId: U(), subjectId: U(), maxMarks: 100, passMarks: 33 }] }),
  },
  "exam.paper.schedule": {
    permission: "exam.manage",
    input: () => ({ examId: U(), papers: [{ paperId: U(), scheduledAt: null }] }),
  },
  "exam.marks_entry.open": { permission: "exam.manage", input: () => ({ examId: U() }) },
  "exam.marks_entry.close": { permission: "exam.manage", input: () => ({ examId: U() }) },
  "exam.marks_entry.reopen": { permission: "exam.manage", input: () => ({ examId: U() }) },
  "exam.verify": { permission: "exam.manage", input: () => ({ examId: U() }) },
  "exam.marks.enter": {
    permission: "exam.marks.enter",
    input: () => ({ examPaperId: U(), marks: [{ studentId: U(), marksObtained: 50, isAbsent: false }] }),
  },
  "exam.result.publish": { permission: "exam.result.publish", input: () => ({ examId: U() }) },
  "exam.recheck.request": {
    permission: "exam.recheck.request",
    input: () => ({ resultId: U(), examPaperId: U(), reason: "Please recheck this paper." }),
  },
  "exam.recheck.review": { permission: "exam.recheck.review", input: () => ({ requestId: U() }) },
  "exam.recheck.decide": { permission: "exam.recheck.decide", input: () => ({ requestId: U(), decision: "reject" }) },
  "exam.remark.save": { permission: "exam.marks.enter", input: () => ({ resultId: U(), remark: "Probe remark." }) },
  "exam.paper.setUnits": { permission: "exam.manage", input: () => ({ paperId: U(), unitIds: [] }) },
  "mastery.intervention.update": { permission: "mastery.review", input: () => ({ id: U(), status: "active" }) },
  "examSeating.generate": {
    permission: "exam.manage",
    input: () => ({ examId: U(), slotStart: "2026-11-16T04:00:00.000Z", rooms: [{ roomId: U() }] }),
  },
  "finance.structure.upsert": {
    permission: "finance.structure.manage",
    input: () => ({
      academicYearId: U(),
      gradeId: U(),
      name: "Probe",
      components: [{ head: "tuition", amount: 100, frequency: "term" }],
    }),
  },
  "finance.structure.assign": {
    permission: "finance.structure.manage",
    input: () => ({ studentId: U(), feeStructureId: U(), academicYearId: U() }),
  },
  "finance.invoice.generateTerm": { permission: "finance.invoice.generate", input: () => ({ termId: U() }) },
  "finance.invoice.generateStudent": { permission: "finance.invoice.generate", input: () => ({ studentId: U(), termId: U() }) },
  "finance.payment.record": {
    permission: "finance.payment.record",
    input: () => ({ invoiceId: U(), amount: 100, mode: "cash", receivedAt: "2026-10-01", idempotencyKey: U() }),
  },
  "finance.payment.void": {
    permission: "finance.payment.void",
    input: () => ({ paymentId: U(), kind: "void", reason: "Probe reversal reason.", idempotencyKey: U() }),
  },
  "finance.payment.createIntent": {
    permission: "finance.payment.online",
    input: () => ({ invoiceId: U(), amount: 100, idempotencyKey: U() }),
  },
  "finance.reminders.send": { permission: "finance.reminder.send", input: () => ({ termId: U() }) },
  "finance.reminders.sendSelected": { permission: "finance.reminder.send", input: () => ({ invoiceIds: [U()] }) },
  "finance.invoice.generateBulk": { permission: "finance.invoice.generate", input: () => ({ termId: U(), studentIds: [U()] }) },
  "notification.read": { permission: "notification.read", input: () => ({ notificationId: U() }) },
  "assignment.create": { permission: "assignment.manage", input: () => ({ classSectionId: U(), subjectId: U(), title: "Probe" }) },
  "assignment.update": { permission: "assignment.manage", input: () => ({ assignmentId: U(), title: "Probe" }) },
  "assignment.publish": { permission: "assignment.manage", input: () => ({ assignmentId: U() }) },
  "assignment.submit": { permission: "assignment.submit", input: () => ({ assignmentId: U() }) },
  "assignment.grade": { permission: "assignment.manage", input: () => ({ submissionId: U(), score: 1, maxScore: 10 }) },
  "attendance.mark": {
    permission: "attendance.mark",
    input: () => ({ classSectionId: U(), date: "2026-10-01", records: [{ studentId: U(), status: "P" }] }),
  },
  "attendance.submit": { permission: "attendance.mark", input: () => ({ sessionId: U() }) },
  "attendance.correct": { permission: "attendance.correct", input: () => ({ recordId: U(), newStatus: "P", reason: "Probe" }) },
  "attendance.markPeriod": {
    permission: "attendance.mark",
    input: () => ({ classSectionId: U(), periodId: U(), date: "2026-10-01", records: [{ studentId: U(), status: "P" }] }),
  },
  "website.page.create": { permission: "website.edit", input: () => ({ slug: "probe", title: "Probe" }) },
  "website.page.save_version": { permission: "website.edit", input: () => ({ pageId: U(), blocks: [] }) },
  "website.page.publish": { permission: "website.publish", input: () => ({ pageId: U(), versionId: U() }) },
  "website.live_set": { permission: "website.publish", input: () => ({ isLive: true }) },
  "website.theme.save": {
    permission: "website.publish",
    input: () => ({
      primary: "#1E3A8A",
      accent: "#D4A017",
      background: "#FFFDF7",
      foreground: "#1F2937",
      headingFont: "classic_serif",
      bodyFont: "system",
      radius: "small",
      heroStyle: "banner",
    }),
  },
  "website.notice.upsert": {
    permission: "website.edit",
    input: () => ({ title: "Probe", body: "Probe", publishAt: at, isPublic: true }),
  },
  "website.event.upsert": { permission: "website.edit", input: () => ({ title: "Probe", startsAt: at, isPublic: true }) },
  "admissions.enquiry.status": { permission: "admissions.enquiry.write", input: () => ({ enquiryId: U(), status: "contacted" }) },
  "admissions.enquiry.note": { permission: "admissions.enquiry.write", input: () => ({ enquiryId: U(), text: "Probe" }) },
  "admissions.enquiry.assign": { permission: "admissions.enquiry.write", input: () => ({ enquiryId: U(), staffId: U() }) },
  "admissions.enquiry.convert": {
    permission: "admissions.enquiry.write",
    input: () => ({
      enquiryId: U(),
      applicant: { firstName: "Probe", dob: "2015-01-01", gender: "other" },
      guardian: { fullName: "Probe", phone: "9876543210", relationship: "father" },
      gradeId: U(),
      academicYearId: U(),
    }),
  },
  "admissions.application.decide": {
    permission: "admissions.application.decide",
    input: () => ({ applicationId: U(), decision: "offer" }),
  },
  "admissions.enrol": {
    permission: "admissions.enrol",
    input: () => ({ applicationId: U(), classSectionId: U(), feeStructureId: U() }),
  },
  "core.member.invite": { permission: "member.manage", input: () => ({ email: "probe@example.com", role: "teacher" }) },
  "core.member.revokeInvite": { permission: "member.manage", input: () => ({ invitationId: U() }) },
  "core.member.setRole": { permission: "member.manage", input: () => ({ membershipId: U(), role: "teacher" }) },
  "core.member.setStatus": { permission: "member.manage", input: () => ({ membershipId: U(), status: "active" }) },
  "core.academicYear.upsert": {
    permission: "academics.manage",
    input: () => ({ name: "Probe", startsOn: "2026-04-01", endsOn: "2027-03-31" }),
  },
  "core.term.upsert": {
    permission: "academics.manage",
    input: () => ({ academicYearId: U(), name: "Probe", startsOn: "2026-04-01", endsOn: "2026-06-30" }),
  },
  "core.institution.updateSettings": { permission: "institution.settings.manage", input: () => ({ name: "Probe" }) },
  "academics.grade.upsert": {
    permission: "academics.manage",
    input: () => ({ code: "G1", displayName: "Grade 1", sortKey: 1, gradeGroup: "primary" }),
  },
  "academics.section.upsert": {
    permission: "academics.manage",
    input: () => ({ gradeId: U(), academicYearId: U(), name: "Probe" }),
  },
  "academics.subject.upsert": {
    permission: "academics.manage",
    input: () => ({ code: "SUB", name: "Probe", kind: "scholastic" }),
  },
  "academics.subjectAssignment.set": {
    permission: "academics.manage",
    input: () => ({ classSectionId: U(), subjectId: U(), teacherId: U() }),
  },
  "people.department.upsert": { permission: "staff.write", input: () => ({ name: "Probe" }) },
  "people.staff.upsert": {
    permission: "staff.write",
    input: () => ({ employeeNo: "E1", fullName: "Probe", designation: "Teacher" }),
  },
  "people.staffAttendance.mark": {
    permission: "staff.attendance.mark",
    input: () => ({ date: "2026-10-01", records: [{ staffId: U(), status: "present" }] }),
  },
  "people.staffAttendance.checkIn": { permission: "staff.attendance.mark", input: () => ({}) },
  "people.leave.request": {
    permission: "leave.request",
    input: () => ({ leaveType: "casual", startDate: "2026-11-09", endDate: "2026-11-10", reason: "Probe reason" }),
  },
  "people.leave.approve": { permission: "leave.approve", input: () => ({ leaveId: U() }) },
  "people.leave.reject": { permission: "leave.approve", input: () => ({ leaveId: U() }) },
  "people.leave.cancel": { permission: "leave.request", input: () => ({ leaveId: U() }) },
  "studentLeave.request": {
    permission: "student_leave.request",
    input: () => ({ studentId: U(), startDate: "2026-11-09", endDate: "2026-11-10", reason: "Probe reason" }),
  },
  "studentLeave.approve": { permission: "student_leave.approve", input: () => ({ leaveId: U() }) },
  "studentLeave.reject": { permission: "student_leave.approve", input: () => ({ leaveId: U() }) },
  "studentLeave.cancel": { permission: "student_leave.request", input: () => ({ leaveId: U() }) },
  "diary.entry.post": {
    permission: "diary.write",
    input: () => ({ classSectionId: U(), entryDate: "2026-11-09", body: "Probe entry" }),
  },
  "diary.entry.delete": { permission: "diary.write", input: () => ({ entryId: U() }) },
  "diary.acknowledge": { permission: "assignment.read", input: () => ({ entryId: U(), studentId: U() }) },
  "messaging.startThread": {
    permission: "message.send",
    input: () => ({ studentId: U(), counterpartId: U(), subject: "Probe subject", body: "Probe body" }),
  },
  "messaging.send": { permission: "message.send", input: () => ({ threadId: U(), body: "Probe body" }) },
  "messaging.markRead": { permission: "message.read", input: () => ({ threadId: U() }) },
  "practice.submitAttempt": {
    permission: "practice.attempt",
    input: () => ({
      studentId: U(),
      curriculumUnitId: U(),
      difficulty: "easy",
      questions: [{ stem: "Probe?", options: ["a", "b", "c", "d"], answerIndex: 0 }],
      answers: [0],
    }),
  },
  "study.material.save": {
    permission: "ai.study",
    input: () => ({ format: "quick_summary", title: "Probe", sourceKind: "paste", content: { summary: "Probe.", keyPoints: ["a"] } }),
  },
  "study.material.delete": { permission: "ai.study", input: () => ({ materialId: U() }) },
  "study.deck.review": { permission: "ai.study", input: () => ({ materialId: U(), cardId: "c1", grade: "knew" }) },
  "study.quiz.submit": {
    permission: "ai.study",
    input: () => ({
      title: "Probe quiz",
      difficulty: "easy",
      questions: [{ type: "true_false", stem: "Probe?", answer: true, explanation: "" }],
      answers: [true],
      aiChecks: [],
      durationSeconds: 60,
    }),
  },
  "study.plan.save": {
    permission: "ai.study",
    input: () => ({ title: "Probe plan", targetDate: "2099-01-31", minutesPerDay: 30, topics: [{ key: "t1", label: "Probe", subjectId: null, unitId: null, weak: true }] }),
  },
  "study.plan.toggleItem": { permission: "ai.study", input: () => ({ planId: U(), index: 0, done: true }) },
  "study.session.log": { permission: "ai.study", input: () => ({ activity: "reading", minutes: 10 }) },
  "study.teacher.material.save": {
    permission: "resource.manage",
    input: () => ({ format: "quick_summary", title: "Probe", sourceKind: "paste", content: { summary: "Probe.", keyPoints: ["a"] }, sectionIds: [U()] }),
  },
  "study.teacher.material.delete": { permission: "resource.manage", input: () => ({ materialId: U() }) },
  // 0140 study help.
  "study.fileConsent.give": { permission: "ai.study", input: () => ({ agree: true }) },
  "study.teacher.fileConsent.give": { permission: "resource.manage", input: () => ({ agree: true }) },
  "study.mock.save": {
    permission: "ai.study",
    input: () => {
      const unit = U();
      return {
        title: "Mock exam: Probe",
        focusUnitIds: [unit],
        content: {
          difficulty: "easy",
          durationMinutes: 15,
          examLabel: null,
          paperId: null,
          units: [{ id: unit, title: "Probe" }],
          questions: [{ type: "true_false", stem: "Probe?", answer: true, explanation: "" }],
          questionUnits: [0],
        },
      };
    },
  },
  "study.material.saveVariant": { permission: "ai.study", input: () => ({ baseId: U(), title: "Probe", language: "hi", content: {} }) },
  "study.teacher.material.saveVariant": { permission: "resource.manage", input: () => ({ baseId: U(), title: "Probe", language: "hi", content: {} }) },
  "study.teacher.worksheet.save": {
    permission: "resource.manage",
    input: () => ({
      title: "Probe worksheet",
      sourceKind: "paste",
      content: { levels: ["support", "core", "stretch"].map((level) => ({ level, instructions: "Do it.", questions: [{ prompt: "Probe?", answer: "Yes." }] })) },
    }),
  },
  "study.teacher.assign": { permission: "assignment.manage", input: () => ({ materialId: U(), sectionId: U(), publish: false }) },
  "study.question.ask": { permission: "ai.study", input: () => ({ subjectId: U(), contextKind: "general", question: "Probe question?" }) },
  "study.question.answer": { permission: "resource.manage", input: () => ({ questionId: U(), answer: "Probe answer." }) },
  "study.scope.open": { permission: "ai.study", input: () => ({ scope: { subjectIds: [U()] } }) },
  "study.scope.saveMessages": { permission: "ai.study", input: () => ({ itemId: U(), messages: [] }) },
  "study.scope.logTime": { permission: "ai.study", input: () => ({ itemId: U(), minutes: 10 }) },
  // 0139 textbooks + curriculum materials. Upload/attach: staff or students only (guardian and
  // office roles hold academics.read but own no class files); suggest: students only.
  "textbook.suggestNcert": { permission: "resource.manage", input: () => ({}) },
  "textbook.add": { permission: "resource.manage", input: () => ({ gradeId: U(), subjectId: U(), book: { source: "ncert", code: "fegp1" } }) },
  "textbook.remove": { permission: "resource.manage", input: () => ({ textbookId: U() }) },
  "textbook.chapterTitles.set": { permission: "resource.manage", input: () => ({ textbookId: U(), titles: { "1": "Patterns" } }) },
  "textbook.unitChapter.set": { permission: "resource.manage", input: () => ({ unitId: U(), textbookId: U(), chapterNo: 2 }) },
  "curriculum.material.requestUpload": {
    permission: "academics.read",
    input: () => ({ fileName: "notes.pdf", mime: "application/pdf", sizeBytes: 100, target: { gradeId: U(), subjectId: U() } }),
    rolesForbidden: ["admissions", "accountant", "exam_controller", "guardian"],
  },
  "curriculum.material.confirmUpload": { permission: "academics.read", input: () => ({ materialId: U() }) },
  "curriculum.material.attach": {
    permission: "academics.read",
    input: () => ({ materialId: U(), gradeId: U(), subjectId: U(), share: "private" }),
    rolesForbidden: ["admissions", "accountant", "exam_controller", "guardian"],
  },
  "curriculum.material.suggest": {
    permission: "academics.read",
    input: () => ({ materialId: U(), suggest: true }),
    rolesForbidden: ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "guardian"],
  },
  "curriculum.material.review": { permission: "resource.manage", input: () => ({ materialId: U(), decision: "approve" }) },
  "curriculum.material.delete": { permission: "academics.read", input: () => ({ materialId: U() }) },
  "curriculum.material.readUrl": { permission: "academics.read", input: () => ({ materialId: U() }) },
  // 0142 textbook link + PDF (documents entity 'subject_textbook').
  "textbook.link.set": { permission: "resource.manage", input: () => ({ textbookId: U(), url: "https://example.com/book" }) },
  "textbook.file.requestUpload": { permission: "resource.manage", input: () => ({ textbookId: U(), fileName: "book.pdf", sizeBytes: 100 }) },
  "textbook.file.confirmUpload": { permission: "resource.manage", input: () => ({ textbookId: U() }) },
  "textbook.file.remove": { permission: "resource.manage", input: () => ({ textbookId: U() }) },
  "textbook.file.readUrl": { permission: "academics.read", input: () => ({ textbookId: U() }) },
  "people.student.update": { permission: "student.write", input: () => ({ studentId: U(), firstName: "Probe" }) },
  "people.guardian.update": { permission: "student.write", input: () => ({ guardianId: U(), fullName: "Probe" }) },
  "people.guardian.link": {
    permission: "student.write",
    input: () => ({ studentId: U(), relationship: "father", guardianId: U() }),
  },
  "data.import.stage": {
    permission: "data.import",
    input: () => ({
      entityType: "students",
      fileName: "students.csv",
      csv: "admission_no,first_name,last_name,dob,gender,grade,section,roll_no,guardian_name,guardian_phone,guardian_email,guardian_relationship\n",
    }),
  },
  "data.import.commit": { permission: "data.import", input: () => ({ batchId: U() }) },
  "document.requestUpload": {
    permission: "document.write",
    input: () => ({ entityType: "student", entityId: U(), kind: "id_proof", fileName: "file.pdf", mime: "application/pdf", sizeBytes: 1000 }),
  },
  "document.confirmUpload": { permission: "document.write", input: () => ({ documentId: U() }) },
  "document.getReadUrl": { permission: "document.read", input: () => ({ documentId: U() }) },
  "document.delete": { permission: "document.write", input: () => ({ documentId: U() }) },
  "announcement.create": {
    permission: "announcement.manage",
    input: () => ({ title: "Probe", body: "Probe body", audiences: [{ type: "school" }] }),
  },
  "announcement.publish": { permission: "announcement.manage", input: () => ({ announcementId: U() }) },
  "notification.preferences.set": {
    permission: "notification.read",
    input: () => ({ category: "announcement", channel: "sms", enabled: false }),
  },
  "curriculum.unit.upsert": {
    permission: "academics.manage",
    input: () => ({ gradeId: U(), subjectId: U(), title: "Probe Unit", sequence: 1 }),
  },
  "curriculum.topic.upsert": { permission: "academics.manage", input: () => ({ curriculumUnitId: U(), title: "Probe Topic", sequence: 1 }) },
  "curriculum.topic.delete": { permission: "academics.manage", input: () => ({ id: U() }) },
  "curriculum.lessonPlan.upsert": {
    permission: "assignment.manage",
    input: () => ({ classSectionId: U(), subjectId: U(), plannedOn: "2026-07-01", title: "Probe", objectives: "Probe objectives" }),
  },
  "curriculum.lessonPlan.delete": { permission: "assignment.manage", input: () => ({ id: U() }) },
  "curriculum.markCovered": {
    permission: "assignment.manage",
    input: () => ({ classSectionId: U(), curriculumUnitId: U(), covered: true, coveredOn: "2026-07-01" }),
  },
  "timetable.room.upsert": { permission: "timetable.manage", input: () => ({ name: "Probe Room", capacity: 30 }) },
  "timetable.period.upsert": {
    permission: "timetable.manage",
    input: () => ({ seq: 1, name: "Period 1", startsAt: "08:00", endsAt: "08:40" }),
  },
  "timetable.version.create": { permission: "timetable.manage", input: () => ({ academicYearId: U(), name: "Probe" }) },
  "timetable.saveDraft": {
    permission: "timetable.manage",
    input: () => ({
      versionId: U(),
      slots: [{ classSectionId: U(), weekday: 1, periodId: U(), subjectId: U(), teacherId: U(), roomId: U() }],
    }),
  },
  "timetable.publish": { permission: "timetable.manage", input: () => ({ versionId: U() }) },
  "timetable.substitution.assign": {
    permission: "timetable.manage",
    input: () => ({ slotId: U(), date: "2026-11-09", substituteId: U(), note: "Probe teacher is on leave" }),
  },
  "timetable.substitution.cancel": { permission: "timetable.manage", input: () => ({ substitutionId: U() }) },
  "timetable.change.apply": {
    permission: "timetable.manage",
    input: () => ({
      versionId: U(),
      kind: "manual",
      changes: [{ classSectionId: U(), weekday: 1, periodId: U(), after: { subjectId: U(), teacherId: U() } }],
      note: "Probe",
    }),
  },
  "timetable.change.rollback": { permission: "timetable.manage", input: () => ({ changeId: U() }) },
  "timetable.rules.set": {
    permission: "timetable.manage",
    input: () => ({
      rules: {
        max_same_subject_per_day: { enabled: true, value: 2 },
        max_consecutive_teacher: { enabled: false, value: 4 },
        max_teacher_per_day: { enabled: false, value: 6 },
        max_teacher_per_week: { enabled: true, value: 36 },
        subject_time_band: { enabled: false, value: [] },
        lab_rooms: { enabled: false, value: [] },
        spread_across_week: { enabled: false, value: 1 },
        teacher_unavailable: { enabled: true, value: [] },
        substitute_ranking: { enabled: false, value: { sameSubject: 4, sameGrade: 2, fewestToday: 1, notCovering: 3 } },
      },
      reason: "Probe",
    }),
  },
  "timetable.snapshot.create": { permission: "timetable.manage", input: () => ({ versionId: U(), name: "Probe" }) },
  "timetable.snapshot.restore": { permission: "timetable.manage", input: () => ({ snapshotId: U() }) },
  "calendar.event.upsert": {
    permission: "academics.manage",
    input: () => ({ academicYearId: U(), kind: "event", title: "Probe", startsOn: "2026-04-10", endsOn: "2026-04-10" }),
  },
  "calendar.event.delete": { permission: "academics.manage", input: () => ({ id: U() }) },
  "facilities.asset.upsert": { permission: "facilities.manage", input: () => ({ name: "Probe Asset", category: "other" }) },
  "maintenance.request": { permission: "maintenance.request", input: () => ({ location: "Probe Hall", issue: "Probe issue." }) },
  "maintenance.assign": { permission: "facilities.manage", input: () => ({ requestId: U(), assigneeStaffId: U() }) },
  "maintenance.close": { permission: "facilities.manage", input: () => ({ requestId: U() }) },
  "questionBank.create": {
    permission: "question.manage",
    input: () => ({ subjectId: U(), gradeId: U(), type: "short_answer", difficulty: "easy", body: "Probe?", answer: "Probe.", marks: 1 }),
  },
  "questionBank.update": {
    permission: "question.manage",
    input: () => ({ id: U(), subjectId: U(), gradeId: U(), type: "short_answer", difficulty: "easy", body: "Probe?", answer: "Probe.", marks: 1 }),
  },
  "questionBank.archive": { permission: "question.manage", input: () => ({ id: U(), isActive: false }) },
  "questionBank.submitForReview": { permission: "question.manage", input: () => ({ id: U() }) },
  "questionBank.approve": { permission: "question.approve", input: () => ({ id: U() }) },
  "questionBank.reject": { permission: "question.approve", input: () => ({ id: U(), note: "Probe note." }) },
  "questionBank.duplicate": { permission: "question.manage", input: () => ({ id: U() }) },
  "questionBank.import": {
    permission: "question.manage",
    input: () => ({ gradeId: U(), subjectId: U(), csv: "type,difficulty,body,answer,marks\nshort_answer,easy,Probe?,Probe.,1\n" }),
  },
  "questionBank.export": { permission: "question.manage", input: () => ({ gradeId: U(), subjectId: U() }) },
  "questionCollection.create": { permission: "question.manage", input: () => ({ name: "Probe set" }) },
  "questionCollection.update": { permission: "question.manage", input: () => ({ id: U(), visibility: "school" }) },
  "questionCollection.delete": { permission: "question.manage", input: () => ({ id: U() }) },
  "questionCollection.addItems": { permission: "question.manage", input: () => ({ collectionId: U(), questionIds: [U()] }) },
  "questionCollection.removeItems": { permission: "question.manage", input: () => ({ collectionId: U(), questionIds: [U()] }) },
  "transport.vehicle.upsert": {
    permission: "transport.manage",
    input: () => ({ registrationNo: "MH12AB1234", capacity: 10, driverName: "Probe Driver" }),
  },
  "transport.route.upsert": { permission: "transport.manage", input: () => ({ name: "Probe Route" }) },
  "transport.stop.upsert": {
    permission: "transport.manage",
    input: () => ({ routeId: U(), seq: 1, name: "Probe Stop", eta: "07:00", mapX: 10, mapY: 10 }),
  },
  "transport.assign": { permission: "transport.manage", input: () => ({ studentId: U(), stopId: U() }) },
  "transport.unassign": { permission: "transport.manage", input: () => ({ studentId: U() }) },
  "insight.review": { permission: "insight.review", input: () => ({ insightId: U() }) },
  "insight.action": {
    permission: "insight.review",
    input: () => ({ insightId: U(), action: "Probe action", owner: "Probe owner", rationale: "Probe rationale.", expectedOutcome: "Probe outcome." }),
  },
  "insight.resolve": { permission: "insight.review", input: () => ({ insightId: U(), note: "Probe resolution note." }) },
  "insight.dismiss": { permission: "insight.review", input: () => ({ insightId: U(), note: "Probe dismissal note." }) },
  // Gate is `insight.read` (every role here passes it except student/guardian),
  // but the handler's own `ai.generate` check (07 §2 — accountant/exam_controller
  // lack it) is what actually decides forbidden vs. past-the-gate here.
  "insight.explain": { permission: "ai.generate", input: () => ({ insightId: U() }) },
  // `insight.read` gates the action, but exam_controller (which has it) has
  // no brief role (rulings "Brief role") — ensureBriefing's own check forbids
  // it before any createClient() call, so it is never "past the gate".
  "briefing.generate": { permission: "insight.read", input: () => ({}), rolesForbidden: ["exam_controller"] },
  "visitors.checkIn": { permission: "visitor.manage", input: () => ({ fullName: "Probe Visitor", phone: "9876543210", purpose: "Probe", meetingWith: "Office" }) },
  "visitors.checkOut": { permission: "visitor.manage", input: () => ({ id: U() }) },
  "visitors.gatePass.create": { permission: "gatepass.manage", input: () => ({ studentId: U(), reason: "Probe reason.", guardianId: U() }) },
  "visitors.gatePass.setStatus": { permission: "gatepass.manage", input: () => ({ id: U(), status: "approved" }) },
  "visitors.pickup.add": {
    permission: "pickup.manage",
    input: () => ({ studentId: U(), fullName: "Probe Person", relation: "driver", phone: "9876543210" }),
  },
  "visitors.pickup.remove": { permission: "pickup.manage", input: () => ({ id: U() }) },
  "clubs.create": { permission: "club.manage", input: () => ({ name: "Probe Club" }) },
  "clubs.update": { permission: "club.manage", input: () => ({ id: U(), name: "Probe Club" }) },
  "clubs.event.create": { permission: "club.manage", input: () => ({ clubId: U(), title: "Probe event", startsAt: "2030-01-01T10:00:00+05:30" }) },
  "clubs.event.cancel": { permission: "club.manage", input: () => ({ id: U() }) },
  "clubs.house.create": { permission: "club.manage", input: () => ({ name: "Probe House" }) },
  "clubs.house.assign": { permission: "club.manage", input: () => ({ houseId: U(), studentId: U() }) },
  "clubs.house.unassign": { permission: "club.manage", input: () => ({ studentId: U() }) },
  "clubs.house.awardPoints": { permission: "club.manage", input: () => ({ houseId: U(), points: 5, reason: "Probe" }) },
  "clubs.join": { permission: "club.join", input: () => ({ clubId: U(), studentId: U() }) },
  "clubs.leave": { permission: "club.join", input: () => ({ clubId: U(), studentId: U() }) },
  "clubs.event.signUp": { permission: "club.join", input: () => ({ eventId: U(), studentId: U() }) },
  "clubs.event.cancelSignup": { permission: "club.join", input: () => ({ eventId: U(), studentId: U() }) },
  "visitors.purge": { permission: "visitor.manage", input: () => ({}) },
  "payroll.structure.save": {
    permission: "payroll.manage",
    input: () => ({ staffId: U(), components: [{ name: "Basic", kind: "earning", amountPaise: 3_000_000 }] }),
  },
  "payroll.run.generate": { permission: "payroll.manage", input: () => ({ month: "2026-10" }) },
  "payroll.run.finalize": { permission: "payroll.manage", input: () => ({ runId: U() }) },
  "scholarships.rule.save": { permission: "concession.manage", input: () => ({ name: "Probe rule", percent: 10 }) },
  "scholarships.rule.setActive": { permission: "concession.manage", input: () => ({ id: U(), isActive: false }) },
  "scholarships.award.request": { permission: "concession.manage", input: () => ({ studentId: U(), ruleId: U(), reason: "Probe request" }) },
  "scholarships.award.decide": { permission: "concession.approve", input: () => ({ awardId: U(), decision: "approved" }) },
  "report.schedule.save": {
    permission: "report.schedule",
    input: () => ({ name: "Probe Report", source: "attendance.daily", cron: "0 20 * * *", recipientRoles: ["principal"] }),
  },
  "report.schedule.setStatus": { permission: "report.schedule", input: () => ({ id: U(), status: "paused" }) },
  "workflow.save": {
    permission: "workflow.manage",
    input: () => ({
      name: "Probe Workflow",
      nodes: [
        { id: "t", type: "trigger", label: "Start", config: { kind: "manual" } },
        { id: "e", type: "end", label: "End", config: {} },
      ],
      edges: [{ source: "t", target: "e" }],
    }),
  },
  "workflow.setStatus": { permission: "workflow.manage", input: () => ({ id: U(), status: "paused" }) },
  "workflow.runNow": { permission: "workflow.manage", input: () => ({ id: U() }) },
  "workflow.run.decide": {
    permission: "workflow.manage",
    input: () => ({ runId: U(), decision: "reject" }),
  },
  "certificate.issue": {
    permission: "certificate.manage",
    input: () => ({ studentId: U(), kind: "bonafide", purpose: "Passport application" }),
  },
  "behaviour.incident.log": { permission: "behaviour.write", input: () => ({ studentId: U(), category: "Probe", severity: "low", points: 1 }) },
  "behaviour.incident.void": { permission: "behaviour.write", input: () => ({ incidentId: U(), reason: "Probe reason" }) },
  "achievement.record": { permission: "achievement.write", input: () => ({ studentId: U(), title: "Probe", category: "other", level: "school", eventDate: "2026-10-10" }) },
  "achievement.verify": { permission: "achievement.verify", input: () => ({ achievementId: U() }) },
  "achievement.void": { permission: "achievement.write", input: () => ({ achievementId: U(), reason: "Probe reason" }) },
  "resource.create": { permission: "resource.manage", input: () => ({ title: "Probe", kind: "note", description: "Probe note", subjectId: U(), classSectionIds: [] }) },
  "resource.attachFile": { permission: "resource.manage", input: () => ({ resourceId: U(), documentId: U() }) },
  "resource.publish": { permission: "resource.manage", input: () => ({ resourceId: U(), published: true }) },
  "resource.delete": { permission: "resource.manage", input: () => ({ resourceId: U() }) },
  "helpdesk.ticket.raise": { permission: "helpdesk.raise", input: () => ({ category: "other", priority: "low", subject: "Probe", body: "Probe body" }) },
  "helpdesk.ticket.update": { permission: "helpdesk.manage", input: () => ({ ticketId: U(), status: "closed", assigneeStaffId: null }) },
  "helpdesk.message.add": { permission: "helpdesk.raise", input: () => ({ ticketId: U(), body: "Probe reply" }) },
  "helpdesk.message.reply": { permission: "helpdesk.manage", input: () => ({ ticketId: U(), body: "Probe reply" }) },
  "alumni.sync": { permission: "alumni.manage", input: () => ({}) },
  "alumni.profile.update": { permission: "alumni.manage", input: () => ({ id: U(), contactEmail: "", contactPhone: "", occupation: "", city: "" }) },
  "ptm.event.create": {
    permission: "ptm.manage",
    input: () => ({
      title: "Probe",
      eventDate: "2026-11-21",
      dayStartsAt: "09:00",
      dayEndsAt: "13:00",
      slotMinutes: 10,
      bookingClosesAt: "2026-11-20T18:00:00+05:30",
      classSectionIds: [U()],
    }),
  },
  "inventory.item.create": { permission: "inventory.manage", input: () => ({ name: "Probe item", unit: "pcs", reorderLevel: 1 }) },
  "inventory.item.update": { permission: "inventory.manage", input: () => ({ id: U(), name: "Probe item", unit: "pcs", reorderLevel: 1, isActive: true }) },
  "inventory.movement.record": { permission: "inventory.manage", input: () => ({ itemId: U(), kind: "in", quantity: 1 }) },
  "compliance.item.create": { permission: "compliance.manage", input: () => ({ title: "Probe item", category: "safety", dueOn: "2027-01-01" }) },
  "compliance.item.update": { permission: "compliance.manage", input: () => ({ id: U(), title: "Probe item", category: "safety" }) },
  "compliance.item.delete": { permission: "compliance.manage", input: () => ({ id: U() }) },
  "compliance.item.renew": { permission: "compliance.manage", input: () => ({ itemId: U(), newDueOn: "2027-01-01" }) },
  "compliance.starter.load": { permission: "compliance.manage", input: () => ({ items: [{ title: "Fire NOC", dueOn: "2027-01-01" }] }) },
  "duty.type.create": { permission: "duty.manage", input: () => ({ name: "Probe duty", slotsPerDay: 1 }) },
  "duty.type.update": { permission: "duty.manage", input: () => ({ id: U(), name: "Probe duty", slotsPerDay: 1, isActive: true }) },
  "duty.roster.generate": { permission: "duty.manage", input: () => ({ from: "2027-01-04", to: "2027-01-05" }) },
  "duty.assignment.set": { permission: "duty.manage", input: () => ({ assignmentId: U(), cancel: true }) },
  "duty.swap.request": { permission: "duty.swap", input: () => ({ assignmentId: U(), toStaffId: U() }) },
  "duty.swap.respond": { permission: "duty.swap", input: () => ({ requestId: U(), accept: true }) },
  "duty.swap.cancel": { permission: "duty.swap", input: () => ({ requestId: U() }) },
  "expenses.record": { permission: "expense.manage", input: () => ({ categoryId: U(), amount: "150.50", spentOn: "2026-11-10", note: "Probe" }) },
  "expenses.void": { permission: "expense.manage", input: () => ({ id: U(), reason: "Probe reason" }) },
  "expenses.category.create": { permission: "expense.manage", input: () => ({ name: "Probe category" }) },
  "expenses.category.update": { permission: "expense.manage", input: () => ({ id: U(), name: "Probe category", isActive: true }) },
  "expenses.budget.set": { permission: "expense.manage", input: () => ({ categoryId: U(), periodStart: "2026-04-01", periodEnd: "2027-03-31", amount: "1000" }) },
  "hostel.room.create": { permission: "hostel.manage", input: () => ({ block: "A", roomNo: "1", capacity: 2 }) },
  "hostel.room.update": { permission: "hostel.manage", input: () => ({ id: U(), block: "A", roomNo: "1", capacity: 2, isActive: true }) },
  "hostel.allocate": { permission: "hostel.manage", input: () => ({ roomId: U(), studentId: U() }) },
  "hostel.vacate": { permission: "hostel.manage", input: () => ({ allocationId: U() }) },
  "schoolLabs.lab.create": { permission: "lab.manage", input: () => ({ name: "Probe lab", kind: "science", capacity: 30 }) },
  "schoolLabs.lab.update": { permission: "lab.manage", input: () => ({ id: U(), name: "Probe lab", kind: "science", capacity: 30, isActive: true }) },
  "schoolLabs.equipment.create": {
    permission: "lab.manage",
    input: () => ({ labId: U(), name: "Probe", kind: "equipment", quantity: 1, unit: "pcs", hazardClass: null, expiryOn: null, condition: "good" }),
  },
  "schoolLabs.equipment.update": {
    permission: "lab.manage",
    input: () => ({ id: U(), labId: U(), name: "Probe", kind: "equipment", quantity: 1, unit: "pcs", hazardClass: null, expiryOn: null, condition: "good" }),
  },
  "schoolLabs.booking.book": { permission: "lab.book", input: () => ({ labId: U(), classSectionId: U(), subjectId: U(), date: "2026-11-20", periodId: U() }) },
  "schoolLabs.booking.cancel": { permission: "lab.book", input: () => ({ bookingId: U() }) },
  "schoolLabs.experiment.log": { permission: "lab.book", input: () => ({ bookingId: U(), title: "Probe experiment" }) },
  "schoolLabs.experiment.complete": { permission: "lab.book", input: () => ({ id: U(), completed: true }) },
  "schoolLabs.incident.record": { permission: "lab.book", input: () => ({ labId: U(), kind: "breakage", severity: "low", description: "Probe", cost: "10" }) },
  "hostel.rollCall.save": {
    permission: "hostel.manage",
    input: () => ({ takenOn: "2026-11-10", session: "night", entries: [{ studentId: U(), status: "present" }] }),
  },
  "form.create": {
    permission: "form.manage",
    input: () => ({ title: "Probe", fields: [{ type: "text", label: "Probe" }], classSectionIds: [U()] }),
  },
  "form.update": {
    permission: "form.manage",
    input: () => ({ formId: U(), title: "Probe", fields: [{ type: "text", label: "Probe" }], classSectionIds: [U()] }),
  },
  "form.publish": { permission: "form.manage", input: () => ({ formId: U() }) },
  "form.close": { permission: "form.manage", input: () => ({ formId: U() }) },
  "form.respond": { permission: "form.respond", input: () => ({ formId: U(), studentId: null, answers: ["Probe"] }) },
  "ptm.event.publish": { permission: "ptm.manage", input: () => ({ eventId: U() }) },
  "ptm.slots.add": { permission: "ptm.slot.manage", input: () => ({ eventId: U(), from: "10:00", to: "10:30" }) },
  "ptm.slot.remove": { permission: "ptm.slot.manage", input: () => ({ slotId: U() }) },
  "ptm.booking.create": { permission: "ptm.book", input: () => ({ slotId: U(), studentId: U() }) },
  "ptm.booking.cancel": { permission: "ptm.book", input: () => ({ bookingId: U() }) },
  "survey.create": {
    permission: "survey.manage",
    input: () => ({
      title: "Probe",
      closesAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      questions: [{ type: "text", prompt: "Probe?" }],
      audiences: [{ type: "school" }],
    }),
  },
  "survey.close": { permission: "survey.manage", input: () => ({ surveyId: U() }) },
  "survey.respond": { permission: "survey.respond", input: () => ({ surveyId: U(), answers: ["Probe answer"] }) },
  "feePlans.lateFeeRule.upsert": {
    permission: "finance.plan.manage",
    input: () => ({ feeStructureId: U(), kind: "flat", amount: 100, cap: null }),
  },
  "feePlans.instalments.set": {
    permission: "finance.plan.manage",
    input: () => ({
      invoiceId: U(),
      parts: [
        { dueOn: "2026-11-10", amount: 100 },
        { dueOn: "2026-12-10", amount: 100 },
      ],
    }),
  },
  "fabric.simulator.create": {
    permission: "scenario.manage",
    input: () => ({
      name: "Probe scenario",
      assumptions: {
        enrolment_delta_pct: 0,
        staff_delta: 0,
        fee_change_pct: 0,
        cost_change_pct: 0,
        periods_per_day: 8,
        horizon_months: 12,
      },
    }),
  },
  "fabric.simulator.update": { permission: "scenario.manage", input: () => ({ id: U(), name: "Probe scenario 2" }) },
  // Gate is `scenario.manage` (owner/principal/admin); approve/reject is
  // further restricted to owner/principal by the handler (M106 rulings).
  "fabric.simulator.decide": {
    permission: "scenario.manage",
    input: () => ({ id: U(), decision: "approved" }),
    rolesForbidden: ["admin"],
  },
  "fabric.simulator.delete": { permission: "scenario.manage", input: () => ({ id: U() }) },
  "studio.request.submit": {
    permission: "studio.request",
    input: () => ({
      title: "Probe",
      problem: "Probe problem.",
      desiredOutcome: "Probe outcome.",
      budgetRange: "under_50k",
      timeline: "1 month",
      successCriteria: "Probe criteria.",
    }),
  },
  "studio.request.propose": { permission: "studio.request", input: () => ({ requestId: U() }) },
  "studio.request.decide": { permission: "studio.approve", input: () => ({ requestId: U(), decision: "approve" }) },
  "health.profile.save": { permission: "health.write", input: () => ({ studentId: U(), allergies: "Probe" }) },
  "health.visit.add": { permission: "health.write", input: () => ({ studentId: U(), complaint: "Probe complaint." }) },
  "health.vaccination.add": { permission: "health.write", input: () => ({ studentId: U(), vaccine: "Probe", administeredOn: "2026-01-01" }) },
  "safety.alert.preview": { permission: "safety.alert.send", input: () => ({ audience: "all" }) },
  "safety.alert.send": { permission: "safety.alert.send", input: () => ({ kind: "drill", title: "Probe", message: "Probe message", audience: "all" }) },
  "safety.alert.close": { permission: "safety.alert.send", input: () => ({ alertId: U() }) },
  "safety.alert.acknowledge": { permission: "safety.alert.read", input: () => ({ alertId: U() }) },
  "safety.headcount.mark": { permission: "safety.headcount.mark", input: () => ({ alertId: U(), classSectionId: U(), presentCount: 1, missingCount: 0 }) },
};

type CallableAction = (slug: string, raw: unknown, overrideCtx: TenantContext) => Promise<ActionResult<unknown>>;

function ctxFor(role: Role): TenantContext {
  const isStaff = role !== "student" && role !== "guardian";
  return {
    institution: { id: U(), slug: "escalation", name: "Escalation", settings: { modules: allModulesOn() }, ai_policy: "local_only", is_demo: true },
    user: { id: U(), profile: { fullName: "Probe", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: {
      role,
      staffId: isStaff ? U() : null,
      guardianId: role === "guardian" ? U() : null,
      studentId: role === "student" ? U() : null,
    },
    permissions: new Set(permissionsFor(role)),
  };
}

function countDefineActionCalls(): number {
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return /\.tsx?$/.test(e.name) ? [full] : [];
    });
  return walk(path.join(process.cwd(), "src"))
    .filter((f) => !f.endsWith(path.join("lib", "actions", "define-action.ts")))
    .reduce((n, f) => n + [...fs.readFileSync(f, "utf8").matchAll(/defineAction\s*(?:<[^>]*>)?\s*\(\s*\{/g)].length, 0);
}

const registry = getRegisteredActions();

beforeAll(() => {
  // Authorized calls end in the handler's createClient() throw, logged as `internal`.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe("C-03: action registry walk", () => {
  it("the registry holds every defineAction call in src (missing registration fails)", () => {
    expect(registry.size).toBe(countDefineActionCalls());
  });

  it("every registered action has an escalation fixture, and no fixture is stale", () => {
    expect([...registry.keys()].sort()).toEqual(Object.keys(FIXTURES).sort());
  });

  describe.each([...registry.keys()].sort())("%s", (name) => {
    const action = registry.get(name) as unknown as CallableAction;
    const fixture = FIXTURES[name];

    it.each(ROLES)("as %s: forbidden exactly when the role lacks the permission", async (role) => {
      const result = await action("escalation", fixture.input(), ctxFor(role));
      const allowed = permissionsFor(role).includes(fixture.permission) && !fixture.rolesForbidden?.includes(role);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      if (allowed) {
        expect(["forbidden", "validation_failed"]).not.toContain(result.error.code);
      } else {
        expect(result.error.code).toBe("forbidden");
      }
    });

    it("unknown keys are rejected as validation_failed (strict schemas)", async () => {
      const result = await action("escalation", { ...fixture.input(), injected: true }, ctxFor("owner"));
      expect(result).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    });
  });
});
