import { describe, expect, it } from "vitest";
import { MODULES } from "@/lib/modules/catalog";
import { brandingStyle, contrastRatio, isHexColour, isLogoMime, isLogoPathOf, logoPathFor, readableOn } from "@/modules/core/setup/branding-utils";
import { BUNDLES, BUNDLE_TIERS, bundleTotalInr, recommendedTier } from "@/modules/core/setup/bundles";
import { suggestColumnMapping, unmappedColumns } from "@/modules/core/setup/column-mapping";
import { parseEmailList } from "@/modules/core/setup/email-list";
import { STAFF_COLUMNS, STUDENT_COLUMNS } from "@/modules/imports/schemas";

describe("suggestColumnMapping", () => {
  it("matches exact names ignoring case, spaces and punctuation", () => {
    const m = suggestColumnMapping(["Admission No", "FIRST-NAME", "dob"], STUDENT_COLUMNS);
    expect(m).toEqual({ "Admission No": "admission_no", "FIRST-NAME": "first_name", dob: "dob" });
  });
  it("maps aliases", () => {
    const m = suggestColumnMapping(["Adm No", "Date of Birth", "Father Name", "Mobile", "Class", "Sec"], STUDENT_COLUMNS);
    expect(m).toEqual({ "Adm No": "admission_no", "Date of Birth": "dob", "Father Name": "guardian_name", Mobile: "guardian_phone", Class: "grade", Sec: "section" });
  });
  it("prefers an exact match over an alias and claims each column once", () => {
    const m = suggestColumnMapping(["Name", "first_name"], STUDENT_COLUMNS);
    expect(m).toEqual({ Name: null, first_name: "first_name" });
  });
  it("leaves unknown headers null and reports unmapped required columns", () => {
    const m = suggestColumnMapping(["Blood group", "Phone"], STAFF_COLUMNS);
    expect(m["Blood group"]).toBeNull();
    expect(m.Phone).toBe("phone");
    expect(unmappedColumns(m, STAFF_COLUMNS)).toEqual(["employee_no", "full_name", "designation", "department", "email", "is_teaching"]);
  });
  it("uses the staff alias for mobile when importing staff", () => {
    expect(suggestColumnMapping(["Mobile"], STAFF_COLUMNS).Mobile).toBe("phone");
  });
});

describe("parseEmailList", () => {
  it("splits on lines, commas and semicolons, lower-cases and de-duplicates", () => {
    const r = parseEmailList("A@x.com, b@x.com\nB@X.com;c@x.com");
    expect(r).toEqual({ valid: ["a@x.com", "b@x.com", "c@x.com"], invalid: [], duplicates: 1 });
  });
  it("flags invalid addresses", () => {
    const r = parseEmailList("good@x.com\nnot-an-email\n@x.com");
    expect(r.valid).toEqual(["good@x.com"]);
    expect(r.invalid).toEqual(["not-an-email", "@x.com"]);
  });
  it("returns nothing for blank input", () => {
    expect(parseEmailList("  \n , ")).toEqual({ valid: [], invalid: [], duplicates: 0 });
  });
});

describe("branding utils", () => {
  it("validates #rrggbb only", () => {
    expect(isHexColour("#1a2B3c")).toBe(true);
    for (const bad of ["#fff", "1a2b3c", "#1a2b3cff", "red", "#1a2b3c;color:red"]) expect(isHexColour(bad)).toBe(false);
  });
  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#ffff00", "#ffffff")).toBeLessThan(4.5);
    expect(contrastRatio("#0a3d91", "#ffffff")).toBeGreaterThan(4.5);
  });
  it("picks a readable text colour and builds a style only for valid colours", () => {
    expect(readableOn("#0a3d91")).toBe("#ffffff");
    expect(readableOn("#ffff00")).toBe("#0a0a0a");
    expect(brandingStyle("#0a3d91")).toMatchObject({ "--primary": "#0a3d91", "--primary-foreground": "#ffffff" });
    expect(brandingStyle("red;}")).toBeUndefined();
    expect(brandingStyle(null)).toBeUndefined();
  });
});

describe("module bundles", () => {
  it("picks the tier by student count", () => {
    expect([0, 299, 300, 999, 1000, 5000].map(recommendedTier)).toEqual(["small", "small", "medium", "medium", "large", "large"]);
  });
  it("uses real, non-core, unique modules with requires listed first", () => {
    for (const tier of BUNDLE_TIERS) {
      const keys = BUNDLES[tier];
      expect(new Set(keys).size).toBe(keys.length);
      keys.forEach((key, i) => {
        const entry = MODULES[key] as { core?: true; requires?: readonly string[] };
        expect(entry.core).toBeUndefined();
        for (const req of entry.requires ?? []) {
          const reqEntry = MODULES[req as keyof typeof MODULES] as { core?: true };
          expect(reqEntry.core === true || (keys.slice(0, i) as readonly string[]).includes(req)).toBe(true);
        }
      });
    }
  });
  it("nests small in medium in large and totals prices", () => {
    expect(BUNDLES.small.every((k) => BUNDLES.medium.includes(k))).toBe(true);
    expect(BUNDLES.medium.every((k) => BUNDLES.large.includes(k))).toBe(true);
    expect(bundleTotalInr("small")).toBe(BUNDLES.small.reduce((s, k) => s + MODULES[k].priceInr, 0));
    expect(bundleTotalInr("large")).toBeGreaterThan(bundleTotalInr("medium"));
  });
});

describe("logo path (0127 school-branding bucket)", () => {
  const id = "11111111-2222-4333-8444-555555555555";
  const other = "99999999-2222-4333-8444-555555555555";
  it("builds <institution_id>/logo.<ext> for png, jpeg and webp only", () => {
    expect(logoPathFor(id, "image/png")).toBe(`${id}/logo.png`);
    expect(logoPathFor(id, "image/jpeg")).toBe(`${id}/logo.jpg`);
    expect(logoPathFor(id, "image/webp")).toBe(`${id}/logo.webp`);
    expect(["image/png", "image/jpeg", "image/webp"].every(isLogoMime)).toBe(true);
    expect(["image/svg+xml", "image/gif", "toString", ""].some(isLogoMime)).toBe(false);
  });
  it("accepts only this school's own logo path", () => {
    expect(isLogoPathOf(id, `${id}/logo.jpeg`)).toBe(true);
    for (const path of [`${other}/logo.png`, `${id}/logo.svg`, `${id}/logo.png/x`, `${id}/x/logo.png`, `${id}logo.png`, `https://x/${id}/logo.png`]) {
      expect(isLogoPathOf(id, path)).toBe(false);
    }
  });
});
