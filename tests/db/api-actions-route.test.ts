// M01-T4 — exercises the real exported POST of
// src/app/api/v1/actions/[name]/route.ts against the live Supabase
// instance and the real action registry (every defineAction()-built
// action, same manifest the dispatcher imports). Real bearer tokens via
// clientAs(role).auth.getSession(), same pattern as bearer-client.test.ts
// — @/lib/supabase/server is NOT mocked, so withBearerToken's real scoping
// is what's under test.
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { POST } from "@/app/api/v1/actions/[name]/route";
import { closeFactoriesHelper, createEnquiry } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type FixtureRole, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

const NOTE_ACTION = "admissions.enquiry.note";

function actionRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/v1/actions/${NOTE_ACTION}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function dispatch(request: Request, name: string = NOTE_ACTION): Promise<Response> {
  return POST(request, { params: Promise.resolve({ name }) });
}

async function tokenFor(inst: TestInstitution, role: FixtureRole): Promise<string> {
  const { data, error } = await inst.clientAs(role).auth.getSession();
  if (error || !data.session) throw error ?? new Error(`no session for ${role}`);
  return data.session.access_token;
}

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

describe("POST /api/v1/actions/[name] (M01-T4)", () => {
  it("admissions bearer adds a note to an enquiry -> 200, row updated", async () => {
    const inst = await createTestInstitution("api-dispatch-ok");
    try {
      const enquiryId = await createEnquiry(inst.institutionId);
      const token = await tokenFor(inst, "admissions");

      const res = await dispatch(
        actionRequest(
          { institution: inst.slug, input: { enquiryId, text: "Called via API." } },
          { authorization: `Bearer ${token}` },
        ),
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.data.notes.at(-1)).toMatchObject({ text: "Called via API." });

      const rows = await sql`select notes from public.enquiries where id = ${enquiryId}::uuid`;
      expect(rows[0]!.notes).toHaveLength(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher bearer -> 403 forbidden (no admissions.enquiry.write)", async () => {
    const inst = await createTestInstitution("api-dispatch-teacher");
    try {
      const token = await tokenFor(inst, "teacher");
      const res = await dispatch(
        actionRequest(
          { institution: inst.slug, input: { enquiryId: crypto.randomUUID(), text: "x" } },
          { authorization: `Bearer ${token}` },
        ),
      );
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("accountant bearer -> 403 forbidden", async () => {
    const inst = await createTestInstitution("api-dispatch-accountant");
    try {
      const token = await tokenFor(inst, "accountant");
      const res = await dispatch(
        actionRequest(
          { institution: inst.slug, input: { enquiryId: crypto.randomUUID(), text: "x" } },
          { authorization: `Bearer ${token}` },
        ),
      );
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("no token -> 401 unauthenticated", async () => {
    const inst = await createTestInstitution("api-dispatch-notoken");
    try {
      const res = await dispatch(
        actionRequest({ institution: inst.slug, input: { enquiryId: crypto.randomUUID(), text: "x" } }),
      );
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("unauthenticated");
    } finally {
      await inst.cleanup();
    }
  });

  it("bearer of a member of another institution -> 404 not_found", async () => {
    const instA = await createTestInstitution("api-dispatch-cross-a");
    const instB = await createTestInstitution("api-dispatch-cross-b");
    try {
      const token = await tokenFor(instA, "admissions");
      const res = await dispatch(
        actionRequest(
          { institution: instB.slug, input: { enquiryId: crypto.randomUUID(), text: "x" } },
          { authorization: `Bearer ${token}` },
        ),
      );
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("not_found");
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  });

  it("unknown action -> 404 not_found", async () => {
    const inst = await createTestInstitution("api-dispatch-unknown");
    try {
      const res = await dispatch(actionRequest({ institution: inst.slug, input: {} }), "no.such.action");
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("not_found");
    } finally {
      await inst.cleanup();
    }
  });

  it("invalid input -> 422 with fieldErrors", async () => {
    const inst = await createTestInstitution("api-dispatch-invalid");
    try {
      const token = await tokenFor(inst, "admissions");
      const res = await dispatch(
        actionRequest({ institution: inst.slug, input: {} }, { authorization: `Bearer ${token}` }),
      );
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error.code).toBe("validation_failed");
      expect(body.error.fieldErrors).toBeDefined();
    } finally {
      await inst.cleanup();
    }
  });

  // Dispatcher CSRF case: every action goes through this one route, so one
  // Origin check guards the whole action surface — unlike
  // /api/public/enquiry and /api/ai/quiz, which each call
  // isCrossSiteRequest themselves.
  it("Origin: https://evil.example -> 403 forbidden (dispatcher CSRF)", async () => {
    const inst = await createTestInstitution("api-dispatch-csrf");
    try {
      const res = await dispatch(
        actionRequest({ institution: inst.slug, input: {} }, { origin: "https://evil.example" }),
      );
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });
});
