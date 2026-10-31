// M02-T7 — GET /api/v1/query: signed-in reference listing every
// registered query's name, permission and input JSON schema. Unit only,
// no DB: @/lib/supabase/server is mocked so getClaims is toggled per test
// and withBearerToken is a passthrough (no real Supabase call). Mirrors
// tests/unit/api-actions-list.test.ts for the actions namespace.
import { describe, expect, it, vi } from "vitest";
import type { JwtPayload } from "@supabase/supabase-js";

const { getClaimsMock } = vi.hoisted(() => ({
  getClaimsMock: vi.fn<() => Promise<JwtPayload | null>>(),
}));

vi.mock("@/lib/supabase/server", async () => ({
  ...(await import("../helpers/server-client-mock")),
  getClaims: getClaimsMock,
  withBearerToken: (_token: string, fn: () => Promise<unknown>) => fn(),
}));

import { GET } from "@/app/api/v1/query/route";
import { getQueryMeta } from "@/lib/actions/define-query";

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/v1/query", { headers });
}

describe("GET /api/v1/query (M02-T7)", () => {
  it("no claims -> 401", async () => {
    getClaimsMock.mockResolvedValueOnce(null);

    const res = await GET(request());

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("unauthenticated");
  });

  it("signed in -> 200, lists every registered query with name, permission, input schema", async () => {
    getClaimsMock.mockResolvedValueOnce({ sub: "user-1" } as JwtPayload);

    const res = await GET(request());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const meta = getQueryMeta();
    expect(body.data).toHaveLength(meta.size);

    const names = body.data.map((entry: { name: string }) => entry.name);
    expect(names).toEqual([...names].sort());

    const listStudents = body.data.find((entry: { name: string }) => entry.name === "people.listStudents");
    expect(listStudents).toBeDefined();
    expect(listStudents.permission).toBe("student.read");
    expect(listStudents.inputSchema.type).toBe("object");
  });

  it("signed in with bearer token -> 200 (withBearerToken passthrough)", async () => {
    getClaimsMock.mockResolvedValueOnce({ sub: "user-1" } as JwtPayload);

    const res = await GET(request({ authorization: "Bearer test-token" }));

    expect(res.status).toBe(200);
  });
});
