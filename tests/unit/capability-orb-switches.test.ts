// Control centre mode/group switches enforced in capabilityState (one place every
// consumer goes through: the chat kernel's tools, aiTaskRoute, the orb feature list).
// A chat tool sits in Ask, a page task in Create, each in its orb group (groupIdFor).
import { describe, expect, it } from "vitest";
import { permissionsFor, type Role } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import { allModulesOn } from "@/lib/modules/catalog";
import { AI_ROLES } from "@/modules/core/schemas";
import { CAPABILITIES, CAPABILITY_KEYS, type CapabilityKey } from "@/modules/ai/capabilities/catalog";
import { capabilityState, enabledCapabilities } from "@/modules/ai/capabilities/resolve";
import { groupIdFor } from "@/modules/ai/components/orb/orb-groups";

function ctxFor(role: Role, aiRoles: Record<string, unknown> = {}): TenantContext {
  return {
    institution: {
      id: "inst-1",
      slug: "caps",
      name: "Caps",
      settings: { modules: allModulesOn(), features: { teacher_ai_agent: true, student_ai_study: true }, ai_roles: aiRoles },
      ai_policy: "local_only",
      is_demo: true,
    },
    user: { id: "user-1", profile: { fullName: "Probe", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role, staffId: null, guardianId: null, studentId: null },
    permissions: new Set(permissionsFor(role)),
  };
}

const modeOf = (key: CapabilityKey) => (CAPABILITIES[key].kind === "chat_tool" ? "ask" : "create");

describe("capabilityState honours the orb mode and group switches", () => {
  it("no mode/group overrides (absent or empty) give identical results for every role and capability", () => {
    for (const role of AI_ROLES) {
      for (const key of CAPABILITY_KEYS) {
        const plain = capabilityState(ctxFor(role), role, key);
        expect(capabilityState(ctxFor(role, { [role]: { modes: {}, groups: {} } }), role, key), `${role}/${key}`).toEqual(plain);
        expect(capabilityState(ctxFor(role, { [role]: { modes: { ask: true, create: true } } }), role, key)).toEqual(plain);
      }
    }
  });

  it("Ask off turns that role's chat tools off and leaves its Create tools and other roles alone", () => {
    const ctx = ctxFor("principal", { principal: { modes: { ask: false } } });
    const before = enabledCapabilities(ctxFor("principal"), "principal");
    const after = enabledCapabilities(ctx, "principal");
    expect(after.length).toBeLessThan(before.length);
    for (const key of before) expect(after.includes(key), key).toBe(modeOf(key) !== "ask");
    const off = before.find((k) => modeOf(k) === "ask")!;
    expect(capabilityState(ctx, "principal", off)).toMatchObject({ on: false, locked: "mode_off" });
    expect(enabledCapabilities(ctx, "owner")).toEqual(enabledCapabilities(ctxFor("owner"), "owner"));
  });

  it("Create off turns that role's drafting/page tasks off", () => {
    const ctx = ctxFor("teacher", { teacher: { modes: { create: false } } });
    const after = enabledCapabilities(ctx, "teacher");
    expect(after.some((k) => modeOf(k) === "create")).toBe(false);
    expect(after.some((k) => modeOf(k) === "ask")).toBe(true);
  });

  it("a group off turns its capabilities off for that role only", () => {
    const ctx = ctxFor("principal", { principal: { groups: { finance: false } } });
    const before = enabledCapabilities(ctxFor("principal"), "principal");
    const finance = before.filter((k) => groupIdFor(k) === "finance");
    expect(finance.length).toBeGreaterThan(0);
    const after = enabledCapabilities(ctx, "principal");
    expect(after).toEqual(before.filter((k) => groupIdFor(k) !== "finance"));
    expect(capabilityState(ctx, "principal", finance[0]!)).toMatchObject({ on: false, locked: "group_off", reason: expect.stringContaining("Finance") });
    expect(enabledCapabilities(ctx, "owner").filter((k) => groupIdFor(k) === "finance").length).toBeGreaterThan(0);
  });

  it("a switch set to true never enables what permission or module forbids", () => {
    const ctx = ctxFor("guardian", { guardian: { modes: { ask: true, create: true }, groups: { finance: true } } });
    for (const key of CAPABILITY_KEYS) {
      if (!CAPABILITIES[key].roles.includes("guardian")) expect(capabilityState(ctx, "guardian", key).on).toBe(false);
    }
  });
});
