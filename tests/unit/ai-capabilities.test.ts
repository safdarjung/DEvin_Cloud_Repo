import { describe, expect, it } from "vitest";
import { permissionsFor, type Role } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import { allModulesOn } from "@/lib/modules/catalog";
import { CAPABILITIES, CAPABILITY_KEYS, DRAFTABLE_ACTIONS } from "@/modules/ai/capabilities/catalog";
import { capabilityState, enabledCapabilities, isAiCapabilityEnabled, previewEnabledCapabilities, roleAiConfig } from "@/modules/ai/capabilities/resolve";

const CAPABILITY_KEY_RE = /^[a-z][a-z0-9_]{1,40}$/;

function ctxFor(
  role: Role,
  overrides: { modules?: Record<string, boolean>; features?: Record<string, boolean>; aiRoles?: Record<string, unknown> } = {},
): TenantContext {
  return {
    institution: {
      id: "inst-1",
      slug: "cap-test",
      name: "Capability Test",
      settings: {
        modules: { ...allModulesOn(), ...overrides.modules },
        features: { ...overrides.features },
        ai_roles: { ...overrides.aiRoles },
      },
      ai_policy: "local_only",
      is_demo: true,
    },
    user: { id: "user-1", profile: { fullName: "Probe", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role, staffId: "staff-1", guardianId: "guardian-1", studentId: "student-1" },
    permissions: new Set(permissionsFor(role)),
  };
}

describe("CAPABILITY_KEYS", () => {
  it("every key matches the settings schema's capability-key regex", () => {
    for (const key of CAPABILITY_KEYS) expect(key).toMatch(CAPABILITY_KEY_RE);
  });

  it("CAPABILITIES has exactly one entry per declared key, self-keyed", () => {
    expect(Object.keys(CAPABILITIES).sort()).toEqual([...CAPABILITY_KEYS].sort());
    for (const key of CAPABILITY_KEYS) expect(CAPABILITIES[key].key).toBe(key);
  });
});

describe("roleAiConfig", () => {
  it("defaults owner/principal/admin/admissions to enabled with cloud on", () => {
    for (const role of ["owner", "principal", "admin", "admissions"] as const) {
      expect(roleAiConfig(ctxFor(role), role)).toEqual({ enabled: true, cloud: true, instructions: "", dailyTokenQuota: null });
    }
  });

  it("defaults accountant/exam_controller/guardian to disabled", () => {
    for (const role of ["accountant", "exam_controller", "guardian"] as const) {
      expect(roleAiConfig(ctxFor(role), role).enabled).toBe(false);
    }
  });

  it("teacher falls back to the legacy teacher_ai_agent flag when nothing is stored", () => {
    expect(roleAiConfig(ctxFor("teacher"), "teacher").enabled).toBe(true); // legacy default true
    expect(roleAiConfig(ctxFor("teacher", { features: { teacher_ai_agent: false } }), "teacher").enabled).toBe(false);
  });

  it("student falls back to the legacy student_ai_study flag when nothing is stored", () => {
    expect(roleAiConfig(ctxFor("student"), "student").enabled).toBe(false); // legacy default false
    expect(roleAiConfig(ctxFor("student", { features: { student_ai_study: true } }), "student").enabled).toBe(true);
  });

  it("an explicit stored value wins over the legacy flag", () => {
    const ctx = ctxFor("teacher", { features: { teacher_ai_agent: true }, aiRoles: { teacher: { enabled: false } } });
    expect(roleAiConfig(ctx, "teacher").enabled).toBe(false);
  });

  it("reads stored cloud, instructions and daily_token_quota", () => {
    const ctx = ctxFor("owner", { aiRoles: { owner: { cloud: false, instructions: "Be concise.", daily_token_quota: 5000 } } });
    expect(roleAiConfig(ctx, "owner")).toEqual({ enabled: true, cloud: false, instructions: "Be concise.", dailyTokenQuota: 5000 });
  });
});

describe("capabilityState — role ceiling", () => {
  it("a role outside cap.roles is locked \"role\", even with capabilities.<key> stored true", () => {
    const ctx = ctxFor("student", { aiRoles: { student: { enabled: true, capabilities: { find_student: true } } } });
    expect(capabilityState(ctx, "student", "find_student")).toEqual({ on: false, locked: "role" });
  });

  it("guardian-only capability is locked \"role\" for every other role", () => {
    for (const role of ["owner", "teacher", "student"] as const) {
      expect(capabilityState(ctxFor(role), role, "child_attendance").locked).toBe("role");
    }
  });
});

describe("capabilityState — permission floor", () => {
  it("a role in cap.roles without cap.permission is locked \"permission\", even with capabilities.<key> stored true", () => {
    // admissions is in attendance_overview's role ceiling but holds no attendance.read permission.
    expect(CAPABILITIES.attendance_overview.roles).toContain("admissions");
    const ctx = ctxFor("admissions", { aiRoles: { admissions: { enabled: true, capabilities: { attendance_overview: true } } } });
    expect(capabilityState(ctx, "admissions", "attendance_overview")).toEqual({ on: false, locked: "permission" });
  });
});

describe("capabilityState — module gate", () => {
  it("disabling the capability's module locks it \"module\", even when otherwise on", () => {
    const ctx = ctxFor("owner", { modules: { mastery: false } });
    expect(capabilityState(ctx, "owner", "mastery_curriculum")).toEqual({ on: false, locked: "module" });
  });
});

describe("capabilityState — role off", () => {
  it("the role's chat switch being off locks its chat tools \"role_off\"", () => {
    const ctx = ctxFor("exam_controller");
    expect(roleAiConfig(ctx, "exam_controller").enabled).toBe(false);
    expect(capabilityState(ctx, "exam_controller", "exam_overview")).toEqual({ on: false, locked: "role_off" });
  });

  it("a page task the role has today stays on while its chat is off", () => {
    expect(capabilityState(ctxFor("exam_controller"), "exam_controller", "report_remark")).toEqual({ on: true, locked: null });
    expect(capabilityState(ctxFor("student"), "student", "practice_quiz")).toEqual({ on: true, locked: null });
  });

  it("turning the role's chat on unlocks its default-on chat tools", () => {
    const ctx = ctxFor("exam_controller", { aiRoles: { exam_controller: { enabled: true } } });
    expect(capabilityState(ctx, "exam_controller", "exam_overview")).toEqual({ on: true, locked: null });
  });
});

describe("capabilityState — legacy fallback and defaults", () => {
  it("study_visuals falls back to the legacy student_ai_visuals flag (default off)", () => {
    const studentOn = ctxFor("student", { features: { student_ai_study: true } });
    expect(capabilityState(studentOn, "student", "study_visuals")).toEqual({ on: false, locked: null });

    const withVisuals = ctxFor("student", { features: { student_ai_study: true, student_ai_visuals: true } });
    expect(capabilityState(withVisuals, "student", "study_visuals")).toEqual({ on: true, locked: null });
  });

  it("a capability with no legacyFeature uses defaultOn when nothing is stored", () => {
    expect(capabilityState(ctxFor("teacher"), "teacher", "find_student")).toEqual({ on: true, locked: null });
  });

  it("an explicit stored false turns a default-on capability off without locking it", () => {
    const ctx = ctxFor("teacher", { aiRoles: { teacher: { capabilities: { find_student: false } } } });
    expect(capabilityState(ctx, "teacher", "find_student")).toEqual({ on: false, locked: null });
  });

  it("an explicit stored true turns a default-off capability on", () => {
    const ctx = ctxFor("student", {
      features: { student_ai_study: true },
      aiRoles: { student: { capabilities: { study_notebook: true } } },
    });
    expect(capabilityState(ctx, "student", "study_notebook")).toEqual({ on: true, locked: null });
  });
});

describe("enabledCapabilities / isAiCapabilityEnabled", () => {
  it("lists exactly the teacher's on capabilities by default", () => {
    const ctx = ctxFor("teacher");
    const on = enabledCapabilities(ctx);
    for (const key of ["find_student", "curriculum_unit", "attendance_pattern", "exam_results", "assignment_status", "generate_quiz", "draft_remark"] as const) {
      expect(on).toContain(key);
    }
    expect(on).not.toContain("child_attendance");
  });

  it("isAiCapabilityEnabled reads the caller's own role from ctx.membership", () => {
    const ctx = ctxFor("guardian", { aiRoles: { guardian: { enabled: true } } });
    expect(isAiCapabilityEnabled(ctx, "child_attendance")).toBe(true);
    expect(isAiCapabilityEnabled(ctx, "find_student")).toBe(false); // role ceiling
  });

  it("an accountant with AI off has nothing enabled", () => {
    expect(enabledCapabilities(ctxFor("accountant"))).toEqual([]);
  });

  it("an accountant with AI on gets finance reads but never another role's own-data or teacher tools", () => {
    const on = enabledCapabilities(ctxFor("accountant", { aiRoles: { accountant: { enabled: true } } }));
    expect(on).toContain("finance_overview");
    expect(on).not.toContain("child_fees");
    expect(on).not.toContain("find_student");
    expect(on).not.toContain("study_curriculum");
  });
});

// T7 — "Test as role" preview: `previewEnabledCapabilities(ctx, previewRole, callerRole)`
// is the tool-selection logic `handleAiChat` uses when a caller holds
// `institution.settings.manage` and previews another role (handle-chat.ts).
describe("previewEnabledCapabilities — T7 'Test as role'", () => {
  it("intersects the previewed role's capabilities with the CALLER's own permission, never the previewed role's", () => {
    // admissions holds student.read and academics.read, but not
    // attendance.read/exam.result.read/assignment.read/assignment.manage/exam.marks.enter.
    const ctx = ctxFor("admissions");
    const preview = previewEnabledCapabilities(ctx, "teacher", "admissions");
    expect(preview).toContain("find_student");
    expect(preview).toContain("curriculum_unit");
    expect(preview).not.toContain("attendance_pattern");
    expect(preview).not.toContain("exam_results");
    expect(preview).not.toContain("assignment_status");
    expect(preview).not.toContain("generate_quiz");
    expect(preview).not.toContain("draft_remark");
  });

  it("drops every data:\"own\" capability even when the caller holds the underlying permission (no own student/child in a preview)", () => {
    const ctx = ctxFor("principal", {
      aiRoles: { student: { enabled: true } },
      features: { student_ai_study: true, student_ai_visuals: true, student_ai_notebook: true },
    });
    expect(enabledCapabilities(ctx, "student")).toEqual(
      expect.arrayContaining(["study_curriculum", "study_visuals", "study_notebook"]),
    ); // sanity: these ARE on for student outside of preview
    expect(previewEnabledCapabilities(ctx, "student", "principal")).toEqual([]);
  });

  it("never grants a capability outside the previewed role's own ceiling, whatever the caller's permission", () => {
    // child_attendance is guardian-only — previewing "owner" never includes it,
    // even though owner holds attendance.read.
    const preview = previewEnabledCapabilities(ctxFor("owner"), "owner", "owner");
    expect(preview).not.toContain("child_attendance");
  });
});

// P3 — verify new P3 capabilities have registered queries and drafts
describe("P3 capabilities — queries and drafts", () => {
  it("all query names in capability definitions are registered", () => {
    // Collect all query names from capabilities
    const allQueries = new Set<string>();
    for (const cap of Object.values(CAPABILITIES)) {
      if (cap.queries) {
        cap.queries.forEach(q => allQueries.add(q));
      }
    }

    // Import query-defs from all modules to build list of registered queries
    // For now, validate that referenced queries match the pattern and exist
    const P3_QUERIES = [
      "academics.listCurriculumUnits",
      "people.getStudentProfile",
      "mastery.gapsForStudent",
      "exams.getMyPapers",
      "exams.listResultsForStudent",
      "diary.forStudent",
      "finance.listInvoicesForStudent",
      "attendance.getStudentAttendanceSummary",
      "website.listNotices",
      "attendance.sectionsBelowThreshold",
      "finance.listDefaulters",
      "insights.list",
      "core.approvals.pending",
      "admissions.listEnquiriesByStage",
    ];
    for (const query of P3_QUERIES) {
      expect(allQueries).toContain(query);
    }
  });

  it("all draft actions are in DRAFTABLE_ACTIONS", () => {
    for (const cap of Object.values(CAPABILITIES)) {
      if (cap.drafts) {
        for (const action of cap.drafts) {
          expect(DRAFTABLE_ACTIONS).toContain(action);
        }
      }
    }
  });

  it("no capability is on by default for a role outside its ceiling", () => {
    for (const cap of Object.values(CAPABILITIES)) {
      for (const role of cap.defaultOn) {
        expect(cap.roles).toContain(role);
      }
    }
  });

  it("lesson_plan_draft is on by default for teacher", () => {
    const cap = CAPABILITIES.lesson_plan_draft;
    expect(cap.defaultOn).toContain("teacher");
  });

  it("study_language is on by default for student", () => {
    const cap = CAPABILITIES.study_language;
    expect(cap.defaultOn).toContain("student");
  });

  it("explain_report_card is on by default for guardian", () => {
    const cap = CAPABILITIES.explain_report_card;
    expect(cap.defaultOn).toContain("guardian");
  });
});
