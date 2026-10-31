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

// 07 §6 C-03 (T-042): walk the action registry and call every action as
// every role. A role without the action's permission must get `forbidden`; a
// role with it must get past the gate; unknown keys must be `validation_failed`.
const ROLES: Role[] = ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"];
const U = () => crypto.randomUUID();
const at = "2026-10-01T09:00:00.000Z";

const FIXTURES: Record<string, { permission: Permission; input: () => Record<string, unknown> }> = {
  "core.feature.set": { permission: "institution.settings.manage", input: () => ({ key: "teacher_ai_agent", enabled: true }) },
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
  "job.requeue": { permission: "job.manage", input: () => ({ jobId: U() }) },
  "exam.create": { permission: "exam.manage", input: () => ({ termId: U(), name: "Probe", type: "unit_test" }) },
  "exam.papers.create": {
    permission: "exam.manage",
    input: () => ({ examId: U(), papers: [{ classSectionId: U(), subjectId: U(), maxMarks: 100, passMarks: 33 }] }),
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
  "notification.read": { permission: "notification.read", input: () => ({ notificationId: U() }) },
  "assignment.create": { permission: "assignment.manage", input: () => ({ classSectionId: U(), subjectId: U(), title: "Probe" }) },
  "assignment.update": { permission: "assignment.manage", input: () => ({ assignmentId: U(), title: "Probe" }) },
  "assignment.publish": { permission: "assignment.manage", input: () => ({ assignmentId: U() }) },
  "attendance.mark": {
    permission: "attendance.mark",
    input: () => ({ classSectionId: U(), date: "2026-10-01", records: [{ studentId: U(), status: "P" }] }),
  },
  "attendance.submit": { permission: "attendance.mark", input: () => ({ sessionId: U() }) },
  "attendance.correct": { permission: "attendance.correct", input: () => ({ recordId: U(), newStatus: "P", reason: "Probe" }) },
  "website.page.create": { permission: "website.edit", input: () => ({ slug: "probe", title: "Probe" }) },
  "website.page.save_version": { permission: "website.edit", input: () => ({ pageId: U(), blocks: [] }) },
  "website.page.publish": { permission: "website.publish", input: () => ({ pageId: U(), versionId: U() }) },
  "website.live_set": { permission: "website.publish", input: () => ({ isLive: true }) },
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
};

type CallableAction = (slug: string, raw: unknown, overrideCtx: TenantContext) => Promise<ActionResult<unknown>>;

function ctxFor(role: Role): TenantContext {
  const isStaff = role !== "student" && role !== "guardian";
  return {
    institution: { id: U(), slug: "escalation", name: "Escalation", settings: {}, ai_policy: "local_only", is_demo: true },
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
      const allowed = permissionsFor(role).includes(fixture.permission);
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
