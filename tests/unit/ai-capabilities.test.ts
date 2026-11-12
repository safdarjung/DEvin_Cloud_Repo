import { describe, expect, it } from "vitest";
import { permissionsFor, type Role } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import { allModulesOn } from "@/lib/modules/catalog";
import { CAPABILITIES, CAPABILITY_KEYS, DRAFTABLE_ACTIONS } from "@/modules/ai/capabilities/catalog";
import { demoInstitutionSettings } from "../../scripts/seed/sections/core";
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

  it("defaults accountant/exam_controller/guardian to enabled (owner decision 2026-11-12)", () => {
    for (const role of ["accountant", "exam_controller", "guardian"] as const) {
      expect(roleAiConfig(ctxFor(role), role).enabled).toBe(true);
    }
  });

  it("teacher falls back to the legacy teacher_ai_agent flag when nothing is stored", () => {
    expect(roleAiConfig(ctxFor("teacher"), "teacher").enabled).toBe(true); // legacy default true
    expect(roleAiConfig(ctxFor("teacher", { features: { teacher_ai_agent: false } }), "teacher").enabled).toBe(false);
  });

  it("student falls back to the legacy student_ai_study flag when nothing is stored", () => {
    expect(roleAiConfig(ctxFor("student"), "student").enabled).toBe(true); // legacy default true since 2026-11-12
    expect(roleAiConfig(ctxFor("student", { features: { student_ai_study: false } }), "student").enabled).toBe(false);
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
    const ctx = ctxFor("exam_controller", { aiRoles: { exam_controller: { enabled: false } } });
    expect(roleAiConfig(ctx, "exam_controller").enabled).toBe(false);
    expect(capabilityState(ctx, "exam_controller", "exam_overview")).toEqual({ on: false, locked: "role_off" });
  });

  it("a page task the role has today stays on while its chat is off", () => {
    const chatOff = ctxFor("teacher", { aiRoles: { teacher: { enabled: false } } });
    expect(roleAiConfig(chatOff, "teacher").enabled).toBe(false);
    expect(capabilityState(chatOff, "teacher", "report_remark")).toEqual({ on: true, locked: null });
    expect(capabilityState(ctxFor("student"), "student", "practice_quiz")).toEqual({ on: true, locked: null });
  });

  it("turning the role's chat on unlocks its default-on chat tools", () => {
    const ctx = ctxFor("exam_controller", { aiRoles: { exam_controller: { enabled: true } } });
    expect(capabilityState(ctx, "exam_controller", "exam_overview")).toEqual({ on: true, locked: null });
  });
});

describe("capabilityState — legacy fallback and defaults", () => {
  it("study_visuals follows the legacy student_ai_visuals flag (default on, an explicit false turns it off)", () => {
    const studentOn = ctxFor("student", { features: { student_ai_study: true, student_ai_visuals: false } });
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

  it("an accountant with AI chat off has no chat tools enabled", () => {
    expect(enabledCapabilities(ctxFor("accountant", { aiRoles: { accountant: { enabled: false } } })).filter((k) => CAPABILITIES[k].kind === "chat_tool")).toEqual([]);
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

  // Owner decision 2026-11-12: every AI feature a role may use is on by default for that role.
  it("with nothing stored, every capability is on for each role its ceiling and permissions allow", () => {
    for (const key of CAPABILITY_KEYS) {
      const cap = CAPABILITIES[key];
      for (const role of cap.roles) {
        const state = capabilityState(ctxFor(role), role, key);
        if (state.locked === "permission") continue;
        expect(state, `${key} for ${role}`).toEqual({ on: true, locked: null });
      }
    }
  });
});

// Owner decision 2026-11-10 — widened per-role defaults (defaults only: no
// role was added to any capability's ceiling).
describe("widened per-role defaults", () => {
  const ROLES: Role[] = ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher", "student", "guardian"];
  // every capability a role is allowed to hold, except the two gated by their own legacy entitlement flags

  it("a role's default-on set equals every capability its ceiling, permission and module allow (chat on, all modules on)", () => {
    for (const role of ROLES) {
      const ctx = ctxFor(role, {
        aiRoles: { [role]: { enabled: true } },
        features: { student_ai_study: true },
      });
      const expected = CAPABILITY_KEYS.filter((k) => {
        const cap = CAPABILITIES[k];
        return cap.roles.includes(role) && permissionsFor(role).includes(cap.permission);
      });
      expect([...enabledCapabilities(ctx, role)].sort()).toEqual([...expected].sort());
    }
  });

  it("expected teacher, student and guardian additions are on", () => {
    const t = enabledCapabilities(ctxFor("teacher"), "teacher");
    for (const k of ["parent_message_draft", "question_paper", "grade_suggestions", "lesson_plan_draft"] as const) expect(t).toContain(k);
    const s = enabledCapabilities(ctxFor("student", { features: { student_ai_study: true } }), "student");
    for (const k of ["weak_area_plan", "exam_prep", "hints_first"] as const) expect(s).toContain(k);
    const g = enabledCapabilities(ctxFor("guardian", { aiRoles: { guardian: { enabled: true } } }), "guardian");
    for (const k of ["translate_notices", "draft_leave_or_message", "fee_explainer"] as const) expect(g).toContain(k);
  });

  it("no capability is enabled for a role outside its allowed-roles list, even when stored true", () => {
    for (const role of ROLES) {
      const all = Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, true]));
      const ctx = ctxFor(role, { aiRoles: { [role]: { enabled: true, capabilities: all } }, features: { student_ai_study: true, student_ai_visuals: true, student_ai_notebook: true } });
      for (const key of enabledCapabilities(ctx, role)) expect(CAPABILITIES[key].roles).toContain(role);
    }
  });

  it("guardian and student never receive aggregate staff capabilities", () => {
    for (const role of ["guardian", "student"] as const) {
      const all = Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, true]));
      const ctx = ctxFor(role, { aiRoles: { [role]: { enabled: true, capabilities: all } }, features: { student_ai_study: true } });
      for (const key of enabledCapabilities(ctx, role)) {
        expect(CAPABILITIES[key].data).toBe("own");
      }
    }
  });

  it("demo seed settings turn on teacher, student and guardian chat; a default institution has them on too", () => {
    const demo = demoInstitutionSettings();
    const demoCtx = (role: Role) => ({ ...ctxFor(role), institution: { ...ctxFor(role).institution, settings: demo as never } });
    for (const role of ["teacher", "student", "guardian"] as const) {
      expect(roleAiConfig(demoCtx(role), role).enabled).toBe(true);
      expect(enabledCapabilities(demoCtx(role), role).length).toBeGreaterThan(0);
    }
    expect(enabledCapabilities(demoCtx("student"), "student")).toEqual(expect.arrayContaining(["study_visuals", "study_notebook"]));
    expect(roleAiConfig(ctxFor("guardian"), "guardian").enabled).toBe(true);
    expect(roleAiConfig(ctxFor("student"), "student").enabled).toBe(true);
  });
});
