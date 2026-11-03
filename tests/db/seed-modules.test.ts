import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { MODULES, type OptionalModuleKey, allModulesOn } from "../../src/lib/modules/catalog";

// MOD-T14: verify demo tenant has all modules enabled.

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

describe("MOD-T14 seed modules", () => {
  it("demo tenant settings.modules equals allModulesOn()", async () => {
    const [row] = await sql`
      select settings from public.institutions where slug = 'st-josephs-demo'
    `;
    expect(row).toBeDefined();
    expect(row.settings).toBeDefined();
    expect(row.settings.modules).toEqual(allModulesOn());
  });

  it("allModulesOn() returns every optional module as true", () => {
    const result = allModulesOn();
    // Verify structure: each key in result should map to true
    const optionalKeys = Object.keys(MODULES).filter(
      (k) => !('core' in MODULES[k as keyof typeof MODULES])
    );
    for (const key of optionalKeys) {
      expect(result[key as OptionalModuleKey]).toBe(true);
    }
  });
});
