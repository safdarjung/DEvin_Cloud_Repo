// MOD-T12: app.module_catalog + app.module_enabled — drift against
// src/lib/modules/catalog.ts and behavioral parity with isModuleEnabled;
// the re-created app.block_attendance_on_holiday (0075 inlining function).
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import {
  MODULE_KEYS,
  MODULES,
  OPTIONAL_MODULE_KEYS,
  allModulesOn,
  isModuleEnabled,
} from "@/lib/modules/catalog";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createGrade } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const bareInstitutionIds: string[] = [];

afterAll(async () => {
  if (bareInstitutionIds.length > 0) {
    await sql`delete from public.institutions where id in ${sql(bareInstitutionIds)}`;
  }
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function createBareInstitution(settings: Record<string, unknown>): Promise<string> {
  const id = crypto.randomUUID();
  await sql`
    insert into public.institutions (id, slug, name, settings)
    values (${id}, ${`test-mod-t12-${id}`}, 'MOD-T12 test', ${sql.json(JSON.parse(JSON.stringify(settings)))})
  `;
  bareInstitutionIds.push(id);
  return id;
}

async function sqlModuleEnabled(institutionId: string, key: string): Promise<boolean> {
  const [row] = await sql`select app.module_enabled(${institutionId}::uuid, ${key}) as enabled`;
  return row.enabled as boolean;
}

describe("app.module_catalog drift (MOD-T12)", () => {
  it("rows match MODULES keys/defaults exactly", async () => {
    const dbRows = await sql`select key, default_enabled from app.module_catalog order by key`;
    const dbSet = dbRows
      .map((r) => ({ key: r.key as string, default: r.default_enabled as boolean }))
      .sort((a, b) => a.key.localeCompare(b.key));
    const tsSet = MODULE_KEYS.map((key) => ({ key, default: MODULES[key].default })).sort((a, b) => a.key.localeCompare(b.key));
    expect(dbSet).toEqual(tsSet);
  });
});

describe("app.module_enabled parity with isModuleEnabled (MOD-T12)", () => {
  const allOptionalOff = Object.fromEntries(OPTIONAL_MODULE_KEYS.map((k) => [k, false]));

  const variants: Array<[string, Record<string, unknown>]> = [
    ["empty settings", {}],
    ["every optional module off", { modules: allOptionalOff }],
    ["allModulesOn()", { modules: allModulesOn() }],
    [
      "mixed overrides (timetable/finance_plus/exams/ai_teacher off)",
      { modules: { timetable: false, finance_plus: false, exams: false, ai_teacher: false } },
    ],
  ];

  for (const [label, settings] of variants) {
    it(`matches for every MODULE_KEYS entry — ${label}`, async () => {
      const institutionId = await createBareInstitution(settings);
      for (const key of MODULE_KEYS) {
        const expected = isModuleEnabled({ institution: { settings } }, key);
        const actual = await sqlModuleEnabled(institutionId, key);
        expect({ key, actual }, `key=${key}`).toEqual({ key, actual: expected });
      }
    });
  }

  it("unknown key raises", async () => {
    const institutionId = await createBareInstitution({});
    await expect(sqlModuleEnabled(institutionId, "not_a_real_module")).rejects.toThrow(/internal/);
  });

  // Security review (MEDIUM, 2026-11-03): a malformed stored value must
  // degrade to the catalog default like isModuleEnabled does, not raise.
  it("malformed modules.<key> value degrades to the catalog default instead of raising", async () => {
    const institutionId = await createBareInstitution({ modules: { exams: "not-a-bool" } });
    const settings = { modules: { exams: "not-a-bool" } };
    const expected = isModuleEnabled({ institution: { settings } }, "exams");
    expect(expected).toBe(MODULES.exams.default);
    await expect(sqlModuleEnabled(institutionId, "exams")).resolves.toBe(expected);
  });
});

describe("app.block_attendance_on_holiday re-created (MOD-T12)", () => {
  it("still blocks on a holiday with calendar on, and no longer blocks with calendar off", async () => {
    const inst = await createTestInstitution("mod-t12-holiday");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId);

      await sql`
        insert into public.academic_calendar_events (institution_id, academic_year_id, kind, title, starts_on, ends_on, audience, created_by)
        values (${inst.institutionId}, ${yearId}, 'holiday', 'Founders Day', '2026-10-21', '2026-10-21', 'all', ${inst.users.admin.id})
      `;

      await expect(
        sql`insert into public.attendance_sessions (institution_id, class_section_id, date) values (${inst.institutionId}, ${sectionId}, '2026-10-21')`,
      ).rejects.toThrow(/invalid_state/);

      // jsonb_set's create_missing only creates the final path element —
      // settings starts as '{}' with no "modules" key, so build the nested
      // object explicitly instead (same approach as operations-rls.test.ts).
      await sql`update public.institutions set settings = settings || jsonb_build_object('modules', jsonb_build_object('calendar', false)) where id = ${inst.institutionId}`;

      const afterDisable = await sql`
        insert into public.attendance_sessions (institution_id, class_section_id, date)
        values (${inst.institutionId}, ${sectionId}, '2026-10-21')
        returning id
      `;
      expect(afterDisable).toHaveLength(1);
    } finally {
      await inst.cleanup();
    }
  });
});
