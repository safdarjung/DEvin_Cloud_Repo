import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/auth/permissions";
import { mergeRoleConfig } from "@/modules/core/control-centre/merge";
import { PRESETS, presetPatch, previewPatch, resetPatch } from "@/modules/core/control-centre/presets";
import {
  actionVerdict, buildAiTree, buildSystemTree, capabilityVerdict, countOn, filterTree, moduleOffImpact, moduleOn, moduleOnOrder, modeOn,
  type CcModel, type CcSettings, type CcTask,
} from "@/modules/core/control-centre/state";

const task = (over: Partial<CcTask> & Pick<CcTask, "action" | "label">): CcTask => ({ kind: "task", mode: "do", groupId: "operations", roles: ["principal", "teacher"], ...over });
const MODEL: CcModel = {
  actions: [
    task({ action: "library.loan.issue", label: "Issue a library book", module: "library", roles: ["principal", "admin"] }),
    task({ action: "diary.entry.post", label: "Post a diary entry", mode: "teach", groupId: "teaching", module: "diary" }),
    task({ action: "timetable.rules.set", label: "Set timetable rules", mode: "manage", groupId: "timetable", module: "timetable" }),
    task({ action: "attendance.mark", label: "Mark the attendance register", mode: "do", groupId: "attendance", module: "attendance", defaultOn: ["teacher"] }),
    { kind: "excluded", action: "core.member.setRole", reason: "access: slice 2 at the earliest" },
    { kind: "unclassified", action: "hostel.vacate" },
  ],
  capabilities: [
    { key: "ask_school", label: "Ask about the school", description: "Chat", kind: "chat_tool", groupId: "more", module: "core", roles: ["principal", "teacher"], defaultOn: ["principal", "teacher"] },
  ],
  roleEnabledDefault: { owner: true, principal: true, admin: true, admissions: true, accountant: true, exam_controller: true, teacher: true, student: true, guardian: true },
};
const S: CcSettings = { modules: { library: true }, features: {}, ai_roles: {} };
const withS = (p: Partial<CcSettings>): CcSettings => ({ ...S, ...p });
const lib = MODEL.actions[0] as CcTask;

describe("lock chain", () => {
  it("excluded and unclassified rows say so", () => {
    expect(actionVerdict(MODEL, S, "principal", MODEL.actions[4])).toMatchObject({ on: false, lock: "excluded" });
    expect(actionVerdict(MODEL, S, "principal", MODEL.actions[5])).toMatchObject({ on: false, lock: "unclassified", reason: "Not available to AI yet." });
  });

  it("permission outranks module, module outranks role/mode/group/task", () => {
    const s = withS({ modules: { library: false }, ai_roles: { teacher: { enabled: false, modes: { do: false }, groups: { operations: false }, tasks: { "library.loan.issue": false } } } });
    expect(actionVerdict(MODEL, s, "teacher", lib).lock).toBe("permission");
    expect(actionVerdict(MODEL, s, "principal", lib).lock).toBe("module");
    const s2 = withS({ ai_roles: { principal: { enabled: false, modes: { do: false }, groups: { operations: false }, tasks: { "library.loan.issue": false } } } });
    expect(actionVerdict(MODEL, s2, "principal", lib).lock).toBe("role_off");
    const s3 = withS({ ai_roles: { principal: { modes: { do: false }, groups: { operations: false }, tasks: { "library.loan.issue": false } } } });
    expect(actionVerdict(MODEL, s3, "principal", lib).lock).toBe("mode_off");
    const s4 = withS({ ai_roles: { principal: { groups: { operations: false }, tasks: { "library.loan.issue": false } } } });
    expect(actionVerdict(MODEL, s4, "principal", lib).lock).toBe("group_off");
    const s5 = withS({ ai_roles: { principal: { tasks: { "library.loan.issue": false } } } });
    expect(actionVerdict(MODEL, s5, "principal", lib)).toMatchObject({ on: false, lock: "task_off" });
    expect(actionVerdict(MODEL, S, "principal", lib)).toEqual({ on: true });
  });

  it("module off words the reason and offers the fix; the kill switch locks everything", () => {
    const v = actionVerdict(MODEL, withS({ modules: { library: false } }), "principal", lib);
    expect(v.reason).toBe("Off because the Library module is off.");
    expect(v.fix).toEqual({ kind: "module", key: "library" });
    expect(actionVerdict({ ...MODEL, killSwitch: true }, S, "principal", lib).lock).toBe("kill_switch");
  });

  it("a module off locks tasks and capabilities but keeps the stored overrides", () => {
    const stored = { principal: { tasks: { "library.loan.issue": true }, capabilities: { ask_school: false } } };
    const off = withS({ modules: { library: false }, ai_roles: stored });
    expect(actionVerdict(MODEL, off, "principal", lib).on).toBe(false);
    expect(off.ai_roles.principal?.tasks).toEqual({ "library.loan.issue": true });
    expect(actionVerdict(MODEL, withS({ ai_roles: stored }), "principal", lib).on).toBe(true);
    expect(capabilityVerdict(MODEL, withS({}), "principal", MODEL.capabilities[0]).on).toBe(true);
  });
});

describe("defaults", () => {
  it("Ask and Create on, Do/Teach/Learn on, Manage off", () => {
    for (const [m, want] of [["ask", true], ["create", true], ["do", true], ["teach", true], ["learn", true], ["manage", false]] as const) expect(modeOn(S, "principal", m)).toBe(want);
  });
  it("manage tasks are off by default and name the mode as the fix", () => {
    const v = actionVerdict(MODEL, S, "principal", MODEL.actions[2]);
    expect(v).toMatchObject({ on: false, lock: "mode_off", fix: { kind: "mode", mode: "manage" } });
  });
  it("a task default-on for some roles only is off for the others", () => {
    expect(actionVerdict(MODEL, S, "teacher", MODEL.actions[3]).on).toBe(true);
    expect(actionVerdict(MODEL, S, "principal", MODEL.actions[3])).toMatchObject({ on: false, lock: "task_off" });
  });
  it("modes with no rows for a role are hidden; rows the role cannot use sit in the not-available branch", () => {
    const teacher = buildAiTree(MODEL, S, "teacher").map((n) => n.label);
    expect(teacher).toEqual(["Ask", "Do", "Teach", "Manage", "Not available to this role or to AI"]);
    const blocked = buildAiTree(MODEL, S, "teacher").at(-1)!.children.map((c) => c.status);
    expect(new Set(blocked)).toEqual(new Set(["locked"]));
  });
});

describe("module dependents and system tree", () => {
  it("lists dependents transitively, dependents first", () => {
    const impact = moduleOffImpact(MODEL, S, "finance_plus", ["principal"]);
    expect(impact.order.at(-1)).toBe("finance_plus");
    expect(impact.dependents).toEqual(expect.arrayContaining(["online_payments", "fee_plans"]));
    for (const d of impact.dependents) expect(impact.order.indexOf(d)).toBeLessThan(impact.order.indexOf("finance_plus"));
  });
  it("names the tasks that go off under a module", () => {
    expect(moduleOffImpact(MODEL, S, "library", ["principal"]).tasks).toEqual(["Issue a library book"]);
  });
  it("turning a module on lists its requirements first", () => {
    const s = withS({ modules: { finance_plus: false, online_payments: false } });
    const order = moduleOnOrder(s, "online_payments");
    expect(order).toEqual(["finance_plus", "online_payments"]);
    expect(moduleOn(s, "finance_plus")).toBe(false);
  });
  it("a module off because of a needed module says which", () => {
    const tree = buildSystemTree(withS({ modules: { finance_plus: false } }));
    const op = tree.flatMap((c) => c.children).find((n) => n.id === "module:online_payments")!;
    expect(op.reason).toContain("needs");
    expect(op.fix).toEqual({ kind: "module", key: "finance_plus" });
  });
});

describe("presets", () => {
  const effective = (s: CcSettings, role: Role) => (["ask", "do", "create", "teach", "learn", "manage"] as const).filter((m) => modeOn(s, role, m));
  const apply = (id: string, s: CcSettings, role: Role) => {
    const p = PRESETS.find((x) => x.id === id)!;
    return { ...s, ai_roles: { ...s.ai_roles, [role]: mergeRoleConfig(s.ai_roles[role], presetPatch(p, role, s)) } };
  };
  it.each([
    ["ask_only", ["ask"]],
    ["teacher_assist", ["ask", "do", "create", "teach"]],
    ["office_operations", ["ask", "do", "create", "manage"]],
    ["full_orb", ["ask", "do", "create", "teach", "learn", "manage"]],
    ["everything_off", []],
  ])("%s gives the stated modes", (id, want) => {
    expect(effective(apply(id, S, "teacher"), "teacher")).toEqual(want);
  });
  it("a preset clears task and group overrides and switches chat on (off for Everything off)", () => {
    const s = withS({ ai_roles: { teacher: { enabled: false, groups: { teaching: false }, tasks: { "diary.entry.post": false } } } });
    const next = apply("full_orb", s, "teacher");
    expect(next.ai_roles.teacher).toMatchObject({ enabled: true });
    expect(next.ai_roles.teacher?.tasks).toBeUndefined();
    expect(apply("everything_off", s, "teacher").ai_roles.teacher?.enabled).toBe(false);
  });
  it("reset removes every override and restores the chat default", () => {
    const s = withS({ ai_roles: { teacher: { enabled: false, modes: { do: false }, capabilities: { ask_school: false }, instructions: "keep" } } });
    const next = mergeRoleConfig(s.ai_roles.teacher, resetPatch(MODEL, "teacher", s));
    expect(next).toEqual({ enabled: true, instructions: "keep" });
  });
  it("the preview says what changes, role by role", () => {
    const [p] = previewPatch(MODEL, S, ["teacher"], (r) => presetPatch(PRESETS[0], r, S));
    expect(p.lines).toEqual(expect.arrayContaining(["Do mode: on to off", "Teach mode: on to off"]));
    expect(previewPatch(MODEL, S, ["teacher"], (r) => presetPatch(PRESETS[3], r, S))[0].lines).toEqual(["Manage mode: off to on"]);
  });
});

describe("search and filter", () => {
  const tree = buildAiTree(MODEL, S, "principal");
  const leafLabels = (n: ReturnType<typeof filterTree>) => n.flatMap((m) => m.children.flatMap((g) => g.children.map((l) => l.label)));
  it("finds by label and by raw action name", () => {
    expect(leafLabels(filterTree(tree, "library", "all"))).toEqual(["Issue a library book"]);
    expect(leafLabels(filterTree(tree, "loan.issue", "all"))).toEqual(["Issue a library book"]);
    expect(filterTree(tree, "zzz", "all")).toEqual([]);
  });
  it("filters by on / off / locked", () => {
    expect(leafLabels(filterTree(tree, "", "on"))).toContain("Issue a library book");
    expect(leafLabels(filterTree(tree, "", "off"))).toContain("Set timetable rules");
    const locked = filterTree(tree, "", "locked").flatMap((b) => b.children.map((c) => c.id));
    expect(locked).toEqual(expect.arrayContaining(["principal:task:core.member.setRole", "principal:task:hostel.vacate"]));
  });
  it("searches module names and feature names in the system tree", () => {
    const sys = filterTree(buildSystemTree(S), "library", "all");
    expect(sys.flatMap((c) => c.children.map((m) => m.id))).toContain("module:library");
  });
  it("counts leaves that are on", () => {
    const doMode = tree.find((n) => n.label === "Do")!;
    expect(countOn(doMode)).toEqual({ on: 1, total: 2 });
  });
});

import { applyCall, callsFor, inverseCall } from "@/modules/core/control-centre/changes";
describe("changes", () => {
  it("apply then inverse restores the settings, including an absent override", () => {
    const [call] = callsFor(S, "teacher", { t: "task", action: "diary.entry.post" }, false);
    const after = applyCall(S, call);
    expect(after.ai_roles.teacher?.tasks).toEqual({ "diary.entry.post": false });
    const back = applyCall(after, inverseCall(MODEL, S, call));
    expect(back.ai_roles.teacher).toEqual({});
  });
  it("a module switched on brings its requirements first", () => {
    const s = withS({ modules: { finance_plus: false, online_payments: false } });
    expect(callsFor(s, "principal", { t: "module", key: "online_payments" }, true).map((c) => (c as { key: string }).key)).toEqual(["finance_plus", "online_payments"]);
  });
});
