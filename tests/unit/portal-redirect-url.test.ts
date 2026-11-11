import { describe, expect, test } from "vitest";
import { portalRedirectUrl } from "../../src/modules/people/portal-url";

describe("portalRedirectUrl", () => {
  const path = "/st-josephs-demo/portal/helpdesk";

  test("adds student when no other params exist", () => {
    expect(portalRedirectUrl(path, "s1")).toBe(`${path}?student=s1`);
  });

  test("keeps ticket and other params, and adds student once", () => {
    const url = portalRedirectUrl(path, "s1", { ticket: "t9", tab: ["a", "b"], page: undefined, student: "stale" });
    expect(url).toBe(`${path}?ticket=t9&tab=a&tab=b&student=s1`);
    expect(url.match(/student=/g)).toHaveLength(1);
  });

  test("target is always the given pathname, never a caller-supplied URL", () => {
    const url = portalRedirectUrl(path, "s1", { next: "https://evil.example/x", redirect: "//evil.example" });
    expect(url.startsWith(`${path}?`)).toBe(true);
    expect(new URL(url, "https://app.test").host).toBe("app.test");
    expect(new URL(url, "https://app.test").pathname).toBe(path);
  });
});
