import { describe, it, expect } from 'vitest';
import {
  MODULES,
  MODULE_KEYS,
  OPTIONAL_MODULE_KEYS,
  ModuleKey,
  isModuleEnabled,
  allModulesOn,
  MODULE_DISABLED_MESSAGE,
  monthlyTotalInr,
} from '@/lib/modules/catalog';
import { InstitutionSettingsSchema, UpdateInstitutionSettingsSchema, DEFAULT_INSTITUTION_SETTINGS, SetModuleEnabledSchema } from '@/modules/core/schemas';

type TestContext = {
  institution: {
    settings?: Record<string, unknown> | null;
  };
};

describe('modules-catalog', () => {
  describe('MODULES catalog structure', () => {
    it('has entries for all keys', () => {
      for (const key of MODULE_KEYS) {
        expect(MODULES).toHaveProperty(key);
      }
    });

    it('every requires entry is an optional key', () => {
      for (const key in MODULES) {
        const entry = MODULES[key as ModuleKey];
        const requires = (entry as Record<string, unknown>).requires;
        if (requires && Array.isArray(requires)) {
          for (const req of requires) {
            expect(OPTIONAL_MODULE_KEYS).toContain(req);
          }
        }
      }
    });

    it('requires graph is acyclic', () => {
      const visited = new Set<string>();
      const visiting = new Set<string>();

      const hasCycle = (key: string): boolean => {
        if (visiting.has(key)) return true;
        if (visited.has(key)) return false;

        visiting.add(key);
        const entry = MODULES[key as ModuleKey];
        const requires = (entry as Record<string, unknown>).requires;
        if (requires && Array.isArray(requires)) {
          for (const req of requires) {
            if (hasCycle(req)) return true;
          }
        }
        visiting.delete(key);
        visited.add(key);
        return false;
      };

      for (const key of MODULE_KEYS) {
        expect(hasCycle(key)).toBe(false);
      }
    });

    it('core entries have core: true and default: true', () => {
      for (const key of MODULE_KEYS) {
        const entry = MODULES[key];
        if ((entry as Record<string, unknown>).core === true) {
          expect(entry.default).toBe(true);
        }
      }
    });

    it('has descriptions ≤160 chars and labels ≤40 chars', () => {
      for (const key in MODULES) {
        const entry = MODULES[key as ModuleKey];
        expect(entry.label.length).toBeLessThanOrEqual(40);
        expect(entry.description.length).toBeLessThanOrEqual(160);
      }
    });

    it('includes student_leave and diary modules', () => {
      expect(MODULES).toHaveProperty('student_leave');
      expect(MODULES).toHaveProperty('diary');
      expect(MODULES.student_leave.category).toBe('Communication');
      expect(MODULES.diary.category).toBe('Communication');
      expect(MODULES.student_leave.default).toBe(true);
      expect(MODULES.diary.default).toBe(true);
      expect((MODULES.student_leave as Record<string, unknown>).requires).toBeUndefined();
      expect((MODULES.diary as Record<string, unknown>).requires).toBeUndefined();
    });
  });

  describe('isModuleEnabled', () => {
    it('returns true for core modules regardless of stored value', () => {
      const ctx = { institution: { settings: { modules: { core: false } } } };
      expect(isModuleEnabled(ctx as TestContext, 'core')).toBe(true);
    });

    it('returns stored true when explicitly enabled', () => {
      const ctx = { institution: { settings: { modules: { exams: true } } } };
      expect(isModuleEnabled(ctx as TestContext, 'exams')).toBe(true);
    });

    it('returns stored false when explicitly disabled', () => {
      const ctx = { institution: { settings: { modules: { exams: false } } } };
      expect(isModuleEnabled(ctx as TestContext, 'exams')).toBe(false);
    });

    it('returns catalog default when key missing from settings', () => {
      const ctx = { institution: { settings: { modules: {} } } };
      // insights defaults to false, exams defaults to true
      expect(isModuleEnabled(ctx as TestContext, 'insights')).toBe(false);
      expect(isModuleEnabled(ctx as TestContext, 'exams')).toBe(true);
    });

    it('returns catalog default when settings.modules is missing', () => {
      const ctx = { institution: { settings: {} } };
      expect(isModuleEnabled(ctx as TestContext, 'insights')).toBe(false);
      expect(isModuleEnabled(ctx as TestContext, 'exams')).toBe(true);
    });

    it('returns catalog default when settings is missing', () => {
      const ctx = { institution: { settings: undefined } };
      expect(isModuleEnabled(ctx as TestContext, 'insights')).toBe(false);
      expect(isModuleEnabled(ctx as TestContext, 'exams')).toBe(true);
    });

    it('disables module when a required module is disabled', () => {
      // substitution requires staff_attendance and timetable
      const ctx = {
        institution: {
          settings: { modules: { substitution: true, staff_attendance: true, timetable: false } },
        },
      };
      expect(isModuleEnabled(ctx as TestContext, 'substitution')).toBe(false);
    });

    it('disables module when a required module is disabled', () => {
      // online_payments requires finance_plus
      const ctx = {
        institution: {
          settings: { modules: { online_payments: true, finance_plus: false } },
        },
      };
      expect(isModuleEnabled(ctx as TestContext, 'online_payments')).toBe(false);
    });

    it('enables module when all requirements are met', () => {
      const ctx = {
        institution: {
          settings: { modules: { timetable: true, staff_attendance: true, substitution: true } },
        },
      };
      expect(isModuleEnabled(ctx as TestContext, 'substitution')).toBe(true);
    });

    it('handles recursive requires chains', () => {
      // finance_plus defaults to true, online_payments requires finance_plus
      const ctx = {
        institution: {
          settings: { modules: { finance_plus: false } },
        },
      };
      expect(isModuleEnabled(ctx as TestContext, 'online_payments')).toBe(false);
    });

    it('handles missing settings gracefully (defensive read)', () => {
      const ctx = { institution: { settings: { modules: null } } };
      expect(isModuleEnabled(ctx as TestContext, 'exams')).toBe(true);
    });

    it('certificates defaults to true', () => {
      const ctx = { institution: { settings: {} } };
      expect(isModuleEnabled(ctx as TestContext, 'certificates')).toBe(true);
    });

    it('certificates can be disabled', () => {
      const ctx = { institution: { settings: { modules: { certificates: false } } } };
      expect(isModuleEnabled(ctx as TestContext, 'certificates')).toBe(false);
    });

    it('exam_seating is off by default', () => {
      const ctx = { institution: { settings: {} } };
      expect(isModuleEnabled(ctx as TestContext, 'exam_seating')).toBe(false);
    });

    it('exam_seating turns on when stored true', () => {
      const ctx = { institution: { settings: { modules: { exam_seating: true } } } };
      expect(isModuleEnabled(ctx as TestContext, 'exam_seating')).toBe(true);
    });

    it('exam_seating is off when exams is off although stored true', () => {
      const ctx = { institution: { settings: { modules: { exam_seating: true, exams: false } } } };
      expect(isModuleEnabled(ctx as TestContext, 'exam_seating')).toBe(false);
    });

    it('{modules: {exam_seating: true}} parses InstitutionSettingsSchema', () => {
      const settings = { ...DEFAULT_INSTITUTION_SETTINGS, modules: { exam_seating: true } };
      expect(InstitutionSettingsSchema.safeParse(settings).success).toBe(true);
    });

    it('parses {modules: {diary: false}} and returns false for diary', () => {
      const ctx = { institution: { settings: { modules: { diary: false } } } };
      expect(isModuleEnabled(ctx as TestContext, 'diary')).toBe(false);
    });

    it('returns default true for student_leave when not in settings', () => {
      const ctx = { institution: { settings: { modules: {} } } };
      expect(isModuleEnabled(ctx as TestContext, 'student_leave')).toBe(true);
    });
  });

  describe('allModulesOn', () => {
    it('returns object with all optional keys set to true', () => {
      const all = allModulesOn();
      for (const key of OPTIONAL_MODULE_KEYS) {
        expect(all[key]).toBe(true);
      }
    });

    it('includes certificates', () => {
      expect(allModulesOn().certificates).toBe(true);
    });

    it('parses as valid InstitutionSettingsSchema.modules', () => {
      const all = allModulesOn();
      const schema = InstitutionSettingsSchema.shape.modules;
      expect(schema?.safeParse(all).success).toBe(true);
    });

    it('parses in DEFAULT_INSTITUTION_SETTINGS context', () => {
      const settings = { ...DEFAULT_INSTITUTION_SETTINGS, modules: allModulesOn() };
      const result = InstitutionSettingsSchema.safeParse(settings);
      expect(result.success).toBe(true);
    });
  });

  describe('InstitutionSettingsSchema.modules', () => {
    it('accepts missing modules key', () => {
      const settings = { ...DEFAULT_INSTITUTION_SETTINGS };
      const result = InstitutionSettingsSchema.safeParse(settings);
      expect(result.success).toBe(true);
    });

    it('accepts partial modules object', () => {
      const settings = { ...DEFAULT_INSTITUTION_SETTINGS, modules: { exams: false } };
      const result = InstitutionSettingsSchema.safeParse(settings);
      expect(result.success).toBe(true);
    });

    it('parses { modules: { certificates: false } } and turns it off', () => {
      const settings = { ...DEFAULT_INSTITUTION_SETTINGS, modules: { certificates: false } };
      const result = InstitutionSettingsSchema.safeParse(settings);
      expect(result.success).toBe(true);
      expect(result.success && result.data.modules?.certificates).toBe(false);
    });

    it('rejects modules with core key', () => {
      const settings = { ...DEFAULT_INSTITUTION_SETTINGS, modules: { core: true } };
      const result = InstitutionSettingsSchema.safeParse(settings);
      expect(result.success).toBe(false);
    });

    it('rejects modules with unknown key', () => {
      const settings = { ...DEFAULT_INSTITUTION_SETTINGS, modules: { nope: true } };
      const result = InstitutionSettingsSchema.safeParse(settings);
      expect(result.success).toBe(false);
    });

    it('rejects non-boolean values', () => {
      const settings = { ...DEFAULT_INSTITUTION_SETTINGS, modules: { exams: 'yes' } };
      const result = InstitutionSettingsSchema.safeParse(settings);
      expect(result.success).toBe(false);
    });
  });

  describe('UpdateInstitutionSettingsSchema', () => {
    it('rejects modules key in settings', () => {
      const update = { settings: { modules: { exams: true } } };
      const result = UpdateInstitutionSettingsSchema.safeParse(update);
      expect(result.success).toBe(false);
    });

    it('accepts empty settings update', () => {
      const update = { settings: {} };
      const result = UpdateInstitutionSettingsSchema.safeParse(update);
      expect(result.success).toBe(true);
    });

    it('accepts other settings fields', () => {
      const update = {
        settings: {
          locale: { timezone: 'Asia/Kolkata', currency: 'INR' },
        },
      };
      const result = UpdateInstitutionSettingsSchema.safeParse(update);
      expect(result.success).toBe(true);
    });
  });

  describe('SetModuleEnabledSchema', () => {
    it('accepts every optional module key (core.module.set must cover the full catalog)', () => {
      for (const key of OPTIONAL_MODULE_KEYS) {
        const result = SetModuleEnabledSchema.safeParse({ key, enabled: true });
        expect(result.success).toBe(true);
      }
    });
  });

  describe('MODULE_DISABLED_MESSAGE', () => {
    it('is a string', () => {
      expect(typeof MODULE_DISABLED_MESSAGE).toBe('string');
      expect(MODULE_DISABLED_MESSAGE.length).toBeGreaterThan(0);
    });
  });

  describe('priceInr', () => {
    it('every module has an integer price >= 0 and core is 0', () => {
      for (const key of MODULE_KEYS) {
        const e = MODULES[key] as Record<string, unknown>;
        expect(Number.isInteger(e.priceInr)).toBe(true);
        expect(e.priceInr as number).toBeGreaterThanOrEqual(0);
        if (e.core === true) expect(e.priceInr).toBe(0);
      }
    });

    it('monthlyTotalInr sums enabled non-core modules only', () => {
      const off = Object.fromEntries(OPTIONAL_MODULE_KEYS.map((k) => [k, false]));
      expect(monthlyTotalInr({ institution: { settings: { modules: off } } })).toBe(0);
      const one = { ...off, library: true };
      expect(monthlyTotalInr({ institution: { settings: { modules: one } } })).toBe(MODULES.library.priceInr);
      const all = Object.fromEntries(OPTIONAL_MODULE_KEYS.map((k) => [k, true]));
      const sum = OPTIONAL_MODULE_KEYS.reduce((a, k) => a + MODULES[k].priceInr, 0);
      expect(monthlyTotalInr({ institution: { settings: { modules: all } } })).toBe(sum);
    });
  });
});
