import { describe, expect, it } from "vitest";
import { isModuleEnabled, MODULES, OPTIONAL_MODULE_KEYS } from "@/lib/modules/catalog";
import { BUNDLES, starterModules } from "@/modules/core/setup/bundles";

describe("starterModules", () => {
  const modules = starterModules();
  it("turns on exactly the small bundle and covers every optional module", () => {
    expect(Object.keys(modules).sort()).toEqual([...OPTIONAL_MODULE_KEYS].sort());
    expect(OPTIONAL_MODULE_KEYS.filter((k) => modules[k]).sort()).toEqual([...BUNDLES.small].sort());
  });
  it("every module that is on has the modules it requires on", () => {
    const ctx = { institution: { settings: { modules } } };
    for (const key of BUNDLES.small) {
      expect(isModuleEnabled(ctx, key), `${key} requires ${String((MODULES[key] as { requires?: string[] }).requires)}`).toBe(true);
    }
  });
});
