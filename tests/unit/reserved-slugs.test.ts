import { describe, expect, test } from "vitest";
import { MARKETING_SEGMENTS, isMarketingPath } from "@/lib/marketing/routes";
import { CreateInstitutionSchema } from "@/modules/core/schemas";

describe("school slugs vs public marketing paths", () => {
  test.each(MARKETING_SEGMENTS.filter((s) => /^[a-z0-9](-?[a-z0-9])*$/.test(s) && s.length >= 3))(
    "slug %s is rejected",
    (slug) => {
      expect(CreateInstitutionSchema.safeParse({ name: "Test School", slug }).success).toBe(false);
    },
  );

  test("ordinary slug is accepted", () => {
    expect(CreateInstitutionSchema.safeParse({ name: "Test School", slug: "green-valley" }).success).toBe(true);
  });

  test("tenant paths are not marketing paths", () => {
    expect(isMarketingPath("/green-valley/dashboard")).toBe(false);
    expect(isMarketingPath("/pricing")).toBe(true);
    expect(isMarketingPath("/")).toBe(true);
  });
});
