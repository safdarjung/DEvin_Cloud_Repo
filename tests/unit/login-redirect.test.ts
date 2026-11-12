import { describe, expect, it } from "vitest";
import { sanitizeNextPath } from "@/lib/auth/next-url";

describe("sanitizeNextPath (open-redirect guard)", () => {
  it("keeps a same-origin path", () => {
    expect(sanitizeNextPath("/st-josephs-demo/dashboard")).toBe("/st-josephs-demo/dashboard");
  });

  it("falls back to / for an absolute URL to another origin", () => {
    expect(sanitizeNextPath("https://evil.example")).toBe("/");
  });

  it("falls back to / for a protocol-relative URL", () => {
    expect(sanitizeNextPath("//evil.example")).toBe("/");
  });

  it("falls back to / when next is missing", () => {
    expect(sanitizeNextPath(null)).toBe("/");
    expect(sanitizeNextPath(undefined)).toBe("/");
  });

  it("falls back to / for a path that doesn't start with a slash", () => {
    expect(sanitizeNextPath("evil.example")).toBe("/");
  });

  it("rejects backslash and control-character tricks that browsers resolve off-site", () => {
    expect(sanitizeNextPath("/\\evil.example/phish")).toBe("/");
    expect(sanitizeNextPath("/\t/evil.example")).toBe("/");
    expect(sanitizeNextPath("/\n/evil.example")).toBe("/");
  });

  it("keeps a same-origin path whose query holds a URL", () => {
    expect(sanitizeNextPath("/demo/files?src=https://x.example")).toBe("/demo/files?src=https://x.example");
  });
});
