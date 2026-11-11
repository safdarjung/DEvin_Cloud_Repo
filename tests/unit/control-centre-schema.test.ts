import { describe, expect, it } from "vitest";
import { MAX_TASK_OVERRIDES } from "@/modules/core/control-centre/ids";
import { mergeRoleConfig } from "@/modules/core/control-centre/merge";
import { AiRoleConfigPatchSchema, AiRoleConfigSchema } from "@/modules/core/schemas";

describe("AiRoleConfigSchema orb overrides", () => {
  it("settings stored before the control centre still parse", () => {
    expect(AiRoleConfigSchema.safeParse({ enabled: true, cloud: false, instructions: "x", daily_token_quota: 5, capabilities: { find_student: true } }).success).toBe(true);
    expect(AiRoleConfigSchema.safeParse({}).success).toBe(true);
  });
  it("accepts sparse modes, groups and tasks", () => {
    expect(AiRoleConfigSchema.safeParse({ modes: { manage: true }, groups: { finance: false }, tasks: { "library.loan.issue": false } }).success).toBe(true);
  });
  it("refuses an unknown mode, an unknown group id and a malformed task key", () => {
    expect(AiRoleConfigSchema.safeParse({ modes: { chat: true } }).success).toBe(false);
    expect(AiRoleConfigSchema.safeParse({ groups: { nonsense: true } }).success).toBe(false);
    expect(AiRoleConfigSchema.safeParse({ tasks: { "1bad": true } }).success).toBe(false);
    expect(AiRoleConfigSchema.safeParse({ tasks: { "a b": true } }).success).toBe(false);
  });
  it("refuses an oversize task map", () => {
    const tasks = Object.fromEntries(Array.from({ length: MAX_TASK_OVERRIDES + 1 }, (_, i) => [`task.n${i}`, true]));
    expect(AiRoleConfigSchema.safeParse({ tasks }).success).toBe(false);
  });
  it("stored config never holds null; only the patch may", () => {
    expect(AiRoleConfigSchema.safeParse({ modes: { do: null } }).success).toBe(false);
    expect(AiRoleConfigPatchSchema.safeParse({ modes: { do: null } }).success).toBe(true);
  });
});

describe("mergeRoleConfig", () => {
  it("merges maps key-wise, drops null keys and empty maps, replaces scalars", () => {
    const merged = mergeRoleConfig({ enabled: true, modes: { do: false, teach: false }, tasks: { "a.b": true } }, { enabled: false, modes: { do: null, manage: true }, tasks: { "a.b": null } });
    expect(merged).toEqual({ enabled: false, modes: { teach: false, manage: true } });
  });
});
