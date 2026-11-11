import { describe, expect, it } from "vitest";
import { ResourceCreateSchema, isSafeHttpsUrl } from "@/modules/resources/schemas";

const U = "11111111-1111-4111-8111-111111111111";
const base = { title: "Fractions video", subjectId: U, classSectionIds: [U] };

describe("resource schemas", () => {
  it("accepts a link and normalises an uppercase scheme", () => {
    const r = ResourceCreateSchema.parse({ ...base, kind: "link", url: "  HTTPS://Example.com/a?b=1 " });
    expect(r.url).toBe("https://Example.com/a?b=1");
  });

  it.each(["http://example.com", "javascript:alert(1)", "data:text/html,<b>x</b>", "ftp://x.org/a", "//example.com", "https://", "https:// spaced.com", "example.com"])(
    "refuses %s",
    (url) => {
      expect(ResourceCreateSchema.safeParse({ ...base, kind: "link", url }).success).toBe(false);
      expect(isSafeHttpsUrl(url)).toBe(false);
    },
  );

  it("refuses a URL over 2000 chars", () => {
    expect(ResourceCreateSchema.safeParse({ ...base, kind: "video", url: `https://a.com/${"x".repeat(2000)}` }).success).toBe(false);
  });

  it("link and video need a url; file and note must not have one; note needs text", () => {
    expect(ResourceCreateSchema.safeParse({ ...base, kind: "link" }).success).toBe(false);
    expect(ResourceCreateSchema.safeParse({ ...base, kind: "video" }).success).toBe(false);
    expect(ResourceCreateSchema.safeParse({ ...base, kind: "file", url: "https://a.com" }).success).toBe(false);
    expect(ResourceCreateSchema.safeParse({ ...base, kind: "file" }).success).toBe(true);
    expect(ResourceCreateSchema.safeParse({ ...base, kind: "note" }).success).toBe(false);
    expect(ResourceCreateSchema.safeParse({ ...base, kind: "note", description: "Read chapter 4." }).success).toBe(true);
  });

  it("rejects duplicate sections, unknown kind and unknown keys", () => {
    expect(ResourceCreateSchema.safeParse({ ...base, kind: "file", classSectionIds: [U, U] }).success).toBe(false);
    expect(ResourceCreateSchema.safeParse({ ...base, kind: "audio" }).success).toBe(false);
    expect(ResourceCreateSchema.safeParse({ ...base, kind: "file", published: true }).success).toBe(false);
  });
});
