import { describe, expect, it, vi } from "vitest";

// Mirrors tests/security/escalation.test.ts: an authorized call that reaches
// the handler ends at this mock's throw (logged as `internal`), so this walk
// never touches a database — only the gate order (context → module → Zod →
// permission → handler) is under test here.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import "@/app/api/v1/actions/all-actions";
import "@/app/api/v1/query/all-queries";
import { getActionMeta, getRegisteredActions } from "@/lib/actions/registry";
import { getQueryMeta, getRegisteredQueries } from "@/lib/actions/define-query";
import type { ActionResult } from "@/lib/actions/result";
import { permissionsFor } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import {
  MODULE_DISABLED_MESSAGE,
  MODULE_KEYS,
  MODULES,
  OPTIONAL_MODULE_KEYS,
  type ModuleKey,
} from "@/lib/modules/catalog";

type CallableAction = (slug: string, raw: unknown, overrideCtx: TenantContext) => Promise<ActionResult<unknown>>;

const OPTIONAL_SET: ReadonlySet<string> = new Set(OPTIONAL_MODULE_KEYS);
const CORE_KEYS = MODULE_KEYS.filter((key) => !OPTIONAL_SET.has(key));

function allOptionalOn(): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const key of OPTIONAL_MODULE_KEYS) result[key] = true;
  return result;
}

function allOptionalOff(): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const key of OPTIONAL_MODULE_KEYS) result[key] = false;
  return result;
}

function ctxFor(modules: Record<string, boolean>): TenantContext {
  return {
    institution: {
      id: "mg-inst",
      slug: "module-gate",
      name: "Module Gate",
      settings: { modules },
      ai_policy: "local_only",
      is_demo: true,
    },
    user: { id: "mg-user", profile: { fullName: "Probe", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role: "owner", staffId: "mg-staff", guardianId: null, studentId: null },
    permissions: new Set(permissionsFor("owner")),
  };
}

interface Entry {
  kind: "action" | "query";
  name: string;
  module: ModuleKey;
  call: CallableAction;
}

function collectEntries(): Entry[] {
  const entries: Entry[] = [];
  const actions = getRegisteredActions();
  for (const [name, meta] of getActionMeta()) {
    if (!meta.module) continue;
    entries.push({ kind: "action", name, module: meta.module, call: actions.get(name) as unknown as CallableAction });
  }
  const queries = getRegisteredQueries();
  for (const [name, meta] of getQueryMeta()) {
    if (!meta.module) continue;
    entries.push({ kind: "query", name, module: meta.module, call: queries.get(name) as unknown as CallableAction });
  }
  return entries;
}

const entries = collectEntries();
const optionalEntries = entries.filter((e) => OPTIONAL_SET.has(e.module));
const coreEntries = entries.filter((e) => CORE_KEYS.includes(e.module));

describe("module-gate (MOD-T13)", () => {
  it("registered at least one optional-module and one core-module name", () => {
    expect(optionalEntries.length).toBeGreaterThan(0);
    expect(coreEntries.length).toBeGreaterThan(0);
  });

  describe.each(optionalEntries)("$kind $name (module: $module)", (entry) => {
    it("forbidden with MODULE_DISABLED_MESSAGE when its own module is stored false", async () => {
      const ctx = ctxFor({ ...allOptionalOn(), [entry.module]: false });
      const result = await entry.call("module-gate", {}, ctx);
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden", message: MODULE_DISABLED_MESSAGE } });
    });

    const requires = (MODULES[entry.module] as { requires?: readonly string[] }).requires ?? [];
    it.each(requires)("forbidden when required module %s is off, even though it is itself stored true", async (requiredKey) => {
      const ctx = ctxFor({ ...allOptionalOn(), [entry.module]: true, [requiredKey]: false });
      const result = await entry.call("module-gate", {}, ctx);
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden", message: MODULE_DISABLED_MESSAGE } });
    });
  });

  describe.each(coreEntries)("$kind $name (module: $module)", (entry) => {
    it("never returns MODULE_DISABLED_MESSAGE even with every optional module off", async () => {
      const ctx = ctxFor(allOptionalOff());
      const result = await entry.call("module-gate", {}, ctx);
      if (!result.ok) {
        expect(result.error.message).not.toBe(MODULE_DISABLED_MESSAGE);
      }
    });
  });
});
