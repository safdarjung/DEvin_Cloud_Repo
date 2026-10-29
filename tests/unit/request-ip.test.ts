import { afterEach, describe, expect, it } from "vitest";
import { clientIp } from "@/modules/website/request-ip";

const ORIGINAL_VERCEL = process.env.VERCEL;

afterEach(() => {
  if (ORIGINAL_VERCEL === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = ORIGINAL_VERCEL;
});

function requestWithHeaders(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/public/enquiry", { headers });
}

describe("clientIp (security review fix round 1, HIGH — C-81 bypass)", () => {
  it("takes the first entry of a comma-separated x-forwarded-for", () => {
    const req = requestWithHeaders({ "x-forwarded-for": "203.0.113.5, 10.0.0.1, 10.0.0.2" });
    expect(clientIp(req)).toBe("203.0.113.5");
  });

  it("trims whitespace around the first entry", () => {
    const req = requestWithHeaders({ "x-forwarded-for": "  203.0.113.5  , 10.0.0.1" });
    expect(clientIp(req)).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const req = requestWithHeaders({ "x-real-ip": "198.51.100.9" });
    expect(clientIp(req)).toBe("198.51.100.9");
  });

  it("prefers x-forwarded-for over x-real-ip when both are present", () => {
    const req = requestWithHeaders({ "x-forwarded-for": "203.0.113.5", "x-real-ip": "198.51.100.9" });
    expect(clientIp(req)).toBe("203.0.113.5");
  });

  it("returns 'unknown' when neither header is present (never throws)", () => {
    const req = requestWithHeaders({});
    expect(clientIp(req)).toBe("unknown");
  });

  it("returns 'unknown' when x-forwarded-for is present but empty", () => {
    const req = requestWithHeaders({ "x-forwarded-for": "" });
    expect(clientIp(req)).toBe("unknown");
  });

  // Same extraction on Vercel and off it (Vercel's x-real-ip is documented
  // as identical to x-forwarded-for there, and there's no separate
  // "trusted" header format to switch to) — only the trust level attached
  // to the result differs, in the code comment. Both environments are
  // exercised so the branch in clientIp() runs either way.
  it("extracts the same value whether process.env.VERCEL is '1' or unset", () => {
    const req = requestWithHeaders({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" });

    process.env.VERCEL = "1";
    expect(clientIp(req)).toBe("203.0.113.5");

    delete process.env.VERCEL;
    expect(clientIp(req)).toBe("203.0.113.5");
  });
});
