import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/auth/demo-session", () => ({ signInAsDemo: vi.fn(async () => true) }));

const { POST } = await import("@/app/api/public/demo-login/route");
const { signInAsDemo } = await import("@/lib/auth/demo-session");

const BASE = "https://school.example";
function post(body: Record<string, string>, origin = BASE): Request {
  return new Request(`${BASE}/api/public/demo-login`, {
    method: "POST",
    headers: { origin, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
}

const savedFlag = process.env.NEXT_PUBLIC_DEMO_LOGIN_HINTS;
beforeEach(() => {
  process.env.NEXT_PUBLIC_DEMO_LOGIN_HINTS = "true";
});
afterEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_DEMO_LOGIN_HINTS = savedFlag;
});

describe("POST /api/public/demo-login", () => {
  it("signs in an allow-listed demo account and 303s to /select", async () => {
    const res = await POST(post({ email: "student.one@demo.coolskool.test" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${BASE}/select`);
    expect(signInAsDemo).toHaveBeenCalledWith(expect.anything(), "student.one@demo.coolskool.test");
  });

  it("refuses a cross-site POST without signing in", async () => {
    const res = await POST(post({ email: "principal@demo.coolskool.test" }, "https://evil.example"));
    expect(res.headers.get("location")).toBe(`${BASE}/login`);
    expect(signInAsDemo).not.toHaveBeenCalled();
  });

  it("refuses an email outside the demo allow-list", async () => {
    const res = await POST(post({ email: "owner@real-school.example" }));
    expect(res.headers.get("location")).toBe(`${BASE}/login`);
    expect(signInAsDemo).not.toHaveBeenCalled();
  });

  it("does nothing when demo hints are off", async () => {
    process.env.NEXT_PUBLIC_DEMO_LOGIN_HINTS = "false";
    const res = await POST(post({ email: "principal@demo.coolskool.test" }));
    expect(res.headers.get("location")).toBe(`${BASE}/login`);
    expect(signInAsDemo).not.toHaveBeenCalled();
  });

  it("never redirects off-site via next", async () => {
    const res = await POST(post({ email: "principal@demo.coolskool.test", next: "https://evil.example" }));
    expect(res.headers.get("location")).toBe(`${BASE}/select`);
  });
});
