import { describe, it, expect } from "vitest";
import {
  MODULES,
  isModuleEnabled,
  allModulesOn,
} from "../../src/lib/modules/catalog";
import {
  InstitutionSettingsSchema,
  UpdateInstitutionSettingsSchema,
  DEFAULT_INSTITUTION_SETTINGS,
} from "../../src/modules/core/schemas";
import { hasPermission } from "../../src/lib/auth/permissions";

type TestContext = {
  institution: {
    settings?: Record<string, unknown> | null;
  };
};

describe("library module configuration", () => {
  describe("module catalog", () => {
    it("has library module in catalog after calendar", () => {
      expect(MODULES.library).toBeDefined();
      expect(MODULES.library.label).toBe("Library");
      expect(MODULES.library.category).toBe("Operations");
      expect(MODULES.library.description).toContain(
        "Book catalogue with accession numbers"
      );
      expect(MODULES.library.default).toBe(false);
    });
  });

  describe("isModuleEnabled", () => {
    it("library is disabled by default with empty modules object", () => {
      const ctx = { institution: { settings: { modules: {} } } };
      const result = isModuleEnabled(ctx as TestContext, "library");
      expect(result).toBe(false);
    });

    it("library is enabled when allModulesOn() is used", () => {
      const ctx = { institution: { settings: { modules: allModulesOn() } } };
      const result = isModuleEnabled(ctx as TestContext, "library");
      expect(result).toBe(true);
    });

    it("library respects explicit setting", () => {
      expect(
        isModuleEnabled(
          { institution: { settings: { modules: { library: true } } } } as TestContext,
          "library"
        )
      ).toBe(true);
      expect(
        isModuleEnabled(
          { institution: { settings: { modules: { library: false } } } } as TestContext,
          "library"
        )
      ).toBe(false);
    });
  });

  describe("InstitutionSettingsSchema — library settings block", () => {
    it("accepts valid library settings block", () => {
      const settings = {
        ...DEFAULT_INSTITUTION_SETTINGS,
        library: {
          loan_days: 14,
          fine_per_day: 1,
          max_loans_student: 2,
          max_loans_staff: 5,
        },
      };
      const result = InstitutionSettingsSchema.safeParse(settings);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.library).toEqual({
          loan_days: 14,
          fine_per_day: 1,
          max_loans_student: 2,
          max_loans_staff: 5,
        });
      }
    });

    it("rejects fine_per_day < 0", () => {
      const settings = {
        ...DEFAULT_INSTITUTION_SETTINGS,
        library: {
          loan_days: 14,
          fine_per_day: -1,
          max_loans_student: 2,
          max_loans_staff: 5,
        },
      };
      const result = InstitutionSettingsSchema.safeParse(settings);
      expect(result.success).toBe(false);
    });

    it("rejects loan_days = 0", () => {
      const settings = {
        ...DEFAULT_INSTITUTION_SETTINGS,
        library: {
          loan_days: 0,
          fine_per_day: 1,
          max_loans_student: 2,
          max_loans_staff: 5,
        },
      };
      const result = InstitutionSettingsSchema.safeParse(settings);
      expect(result.success).toBe(false);
    });

    it("rejects unknown key inside library block", () => {
      const settings = {
        ...DEFAULT_INSTITUTION_SETTINGS,
        library: {
          loan_days: 14,
          fine_per_day: 1,
          max_loans_student: 2,
          max_loans_staff: 5,
          unknown_key: "should fail",
        } as Record<string, unknown>,
      };
      const result = InstitutionSettingsSchema.safeParse(settings);
      expect(result.success).toBe(false);
    });

    it("parses without library block", () => {
      const settings = DEFAULT_INSTITUTION_SETTINGS;
      const result = InstitutionSettingsSchema.safeParse(settings);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.library).toBeUndefined();
      }
    });
  });

  describe("UpdateInstitutionSettingsSchema", () => {
    it("accepts library block", () => {
      const update = {
        settings: {
          library: {
            loan_days: 21,
            fine_per_day: 2,
            max_loans_student: 3,
            max_loans_staff: 10,
          },
        },
      };
      const result = UpdateInstitutionSettingsSchema.safeParse(update);
      expect(result.success).toBe(true);
    });
  });

  describe("permissions", () => {
    it("admin has both library.manage and library.read", () => {
      expect(hasPermission("admin", "library.manage")).toBe(true);
      expect(hasPermission("admin", "library.read")).toBe(true);
    });

    it("owner has both library.manage and library.read", () => {
      expect(hasPermission("owner", "library.manage")).toBe(true);
      expect(hasPermission("owner", "library.read")).toBe(true);
    });

    it("principal has both library.manage and library.read", () => {
      expect(hasPermission("principal", "library.manage")).toBe(true);
      expect(hasPermission("principal", "library.read")).toBe(true);
    });

    it("teacher has library.read only", () => {
      expect(hasPermission("teacher", "library.manage")).toBe(false);
      expect(hasPermission("teacher", "library.read")).toBe(true);
    });

    it("accountant has library.read only", () => {
      expect(hasPermission("accountant", "library.manage")).toBe(false);
      expect(hasPermission("accountant", "library.read")).toBe(true);
    });

    it("guardian has library.read only", () => {
      expect(hasPermission("guardian", "library.manage")).toBe(false);
      expect(hasPermission("guardian", "library.read")).toBe(true);
    });

    it("student has library.read only", () => {
      expect(hasPermission("student", "library.manage")).toBe(false);
      expect(hasPermission("student", "library.read")).toBe(true);
    });

    it("exam_controller has library.read only", () => {
      expect(hasPermission("exam_controller", "library.manage")).toBe(false);
      expect(hasPermission("exam_controller", "library.read")).toBe(true);
    });

    it("admissions has library.read only", () => {
      expect(hasPermission("admissions", "library.manage")).toBe(false);
      expect(hasPermission("admissions", "library.read")).toBe(true);
    });
  });
});
