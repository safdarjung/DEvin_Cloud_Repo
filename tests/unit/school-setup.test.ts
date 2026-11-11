import { describe, expect, it } from "vitest";
import { buildSchoolTemplate, GRADE_LADDER, MAX_SECTIONS_PER_GRADE } from "@/modules/core/setup/templates";
import {
  ApplyTemplateSchema,
  CreateInstitutionWithInviteSchema,
  SaveBrandingSchema,
  SetProgressSchema,
  StartSchoolSchema,
} from "@/modules/core/setup/schemas";
import { InstitutionSettingsSchema, UpdateInstitutionSettingsSchema } from "@/modules/core/schemas";

const base = { board: "CBSE", fromGrade: "I", toGrade: "V", sectionsPerGrade: 2, yearStart: "2026-04-01" } as const;

describe("buildSchoolTemplate (F18 §H)", () => {
  it("the widest choice stays inside the SQL bounds: 15 grades, 8 sections, 15 subjects, 12 periods", () => {
    const t = buildSchoolTemplate({ ...base, fromGrade: "NUR", toGrade: "XII", sectionsPerGrade: MAX_SECTIONS_PER_GRADE });
    expect(t.grades).toHaveLength(15);
    expect(GRADE_LADDER).toHaveLength(15);
    for (const g of t.grades) {
      expect(g.sections.length).toBeLessThanOrEqual(8);
      expect(g.subjects.length).toBeGreaterThan(0);
      expect(g.subjects.length).toBeLessThanOrEqual(15);
      expect(new Set(g.subjects.map((s) => s.code)).size).toBe(g.subjects.length);
      expect(["primary", "middle", "secondary", "senior_secondary"]).toContain(g.grade_group);
      expect(g.code).toMatch(/^[A-Za-z0-9_-]{1,10}$/);
    }
    expect(t.periods.length).toBeLessThanOrEqual(12);
    expect(t.fee_structure.components.length).toBeLessThanOrEqual(8);
    expect(JSON.stringify(t).length).toBeLessThan(100_000);
  });

  it("year, terms and fees match the SQL contract", () => {
    const t = buildSchoolTemplate(base);
    expect(t.academic_year).toEqual({ name: "2026-27", starts_on: "2026-04-01", ends_on: "2027-03-31" });
    expect(t.terms).toEqual([
      { name: "Term 1", starts_on: "2026-04-01", ends_on: "2026-09-30" },
      { name: "Term 2", starts_on: "2026-10-01", ends_on: "2027-03-31" },
    ]);
    expect(t.grades.map((g) => g.code)).toEqual(["I", "II", "III", "IV", "V"]);
    expect(t.grades[0].sections).toEqual(["A", "B"]);
    expect(t.fee_structure.name).toMatch(/placeholder/i);
    for (const c of t.fee_structure.components) expect(Number.isInteger(c.amount_paise)).toBe(true);
  });

  it("rejects out-of-range choices instead of building an oversized template", () => {
    expect(() => buildSchoolTemplate({ ...base, sectionsPerGrade: 9 })).toThrow(RangeError);
    expect(() => buildSchoolTemplate({ ...base, sectionsPerGrade: 0 })).toThrow(RangeError);
    expect(() => buildSchoolTemplate({ ...base, fromGrade: "V", toGrade: "I" })).toThrow(RangeError);
    expect(() => buildSchoolTemplate({ ...base, yearStart: "2026-02-30" })).toThrow(RangeError);
  });

  it("board changes the catalogue: ICSE splits social science, State swaps Sanskrit", () => {
    const icse = buildSchoolTemplate({ ...base, board: "ICSE", fromGrade: "VI", toGrade: "VI" });
    const codes = icse.grades[0].subjects.map((s) => s.code);
    expect(codes).not.toContain("SST");
    expect(codes).toEqual(expect.arrayContaining(["HCG", "GEO"]));

    const state = buildSchoolTemplate({ ...base, board: "State", fromGrade: "IX", toGrade: "IX" });
    expect(state.grades[0].subjects.map((s) => s.code)).not.toContain("SANS");
  });

  it("senior secondary with three sections offers all three streams", () => {
    const t = buildSchoolTemplate({ ...base, fromGrade: "XI", toGrade: "XI", sectionsPerGrade: 3 });
    expect(t.grades[0].subjects.map((s) => s.code)).toEqual(expect.arrayContaining(["PHY", "ACC", "HIST"]));
  });
});

describe("setup schemas (F18 §H)", () => {
  it("ApplyTemplateSchema bounds sections, orders the grade range and is strict", () => {
    const ok = { board: "CBSE", fromGrade: "I", toGrade: "V", sectionsPerGrade: 2 };
    expect(ApplyTemplateSchema.safeParse(ok).success).toBe(true);
    expect(ApplyTemplateSchema.safeParse({ ...ok, sectionsPerGrade: 9 }).success).toBe(false);
    expect(ApplyTemplateSchema.safeParse({ ...ok, fromGrade: "X", toGrade: "I" }).success).toBe(false);
    expect(ApplyTemplateSchema.safeParse({ ...ok, template: {} }).success).toBe(false);
  });

  it("SaveBrandingSchema accepts #rrggbb only and needs at least one field", () => {
    expect(SaveBrandingSchema.safeParse({ primaryColor: "#1A2b3c" }).data).toEqual({ primaryColor: "#1a2b3c" });
    expect(SaveBrandingSchema.safeParse({ primaryColor: "red" }).success).toBe(false);
    expect(SaveBrandingSchema.safeParse({ primaryColor: "#fff" }).success).toBe(false);
    expect(SaveBrandingSchema.safeParse({}).success).toBe(false);
    const id = crypto.randomUUID();
    expect(SaveBrandingSchema.safeParse({ logoPath: `${id}/logo.webp` }).success).toBe(true);
    for (const logoPath of [`${id}/logo.svg`, `${id}/other.png`, `${id}/x/logo.png`, `https://evil.example/${id}/logo.png`, "logo.png"]) {
      expect(SaveBrandingSchema.safeParse({ logoPath }).success).toBe(false);
    }
    expect(SaveBrandingSchema.safeParse({ logoDocumentId: id }).success).toBe(false);
  });

  it("SetProgressSchema only knows the five steps", () => {
    expect(SetProgressSchema.safeParse({ step: "modules", state: "dismissed" }).success).toBe(true);
    expect(SetProgressSchema.safeParse({ step: "billing", state: "done" }).success).toBe(false);
  });

  it("settings schema accepts branding/setup; updateSettings cannot write them", () => {
    const settings = { branding: { logo_path: `${crypto.randomUUID()}/logo.png`, primary_color: "#112233" }, setup: { people: "dismissed" } };
    expect(InstitutionSettingsSchema.partial().safeParse(settings).success).toBe(true);
    expect(InstitutionSettingsSchema.partial().safeParse({ branding: { primary_color: "blue" } }).success).toBe(false);
    expect(UpdateInstitutionSettingsSchema.safeParse({ settings: { branding: settings.branding } }).success).toBe(false);
    expect(UpdateInstitutionSettingsSchema.safeParse({ settings: { setup: settings.setup } }).success).toBe(false);
  });

  it("StartSchoolSchema validates before any account is created", () => {
    const ok = {
      code: " abcd-efgh ",
      schoolName: "Green Valley School",
      slug: "green-valley",
      ownerName: "Asha Rao",
      email: "Asha@Example.com",
      password: "long-enough-1",
    };
    const parsed = StartSchoolSchema.safeParse(ok);
    expect(parsed.data).toMatchObject({ code: "ABCD-EFGH", email: "asha@example.com" });
    expect(StartSchoolSchema.safeParse({ ...ok, password: "short" }).success).toBe(false);
    expect(StartSchoolSchema.safeParse({ ...ok, slug: "Green_Valley" }).success).toBe(false);
    expect(StartSchoolSchema.safeParse({ ...ok, slug: "login" }).success).toBe(false);
    expect(StartSchoolSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });

  it("the v1 institutions body needs a code and no longer takes timezone/yearStart", () => {
    expect(CreateInstitutionWithInviteSchema.safeParse({ name: "A School", slug: "a-school", code: "X" }).success).toBe(true);
    expect(CreateInstitutionWithInviteSchema.safeParse({ name: "A School", slug: "a-school" }).success).toBe(false);
    expect(
      CreateInstitutionWithInviteSchema.safeParse({ name: "A School", slug: "a-school", code: "X", timezone: "Asia/Kolkata" }).success,
    ).toBe(false);
  });
});
