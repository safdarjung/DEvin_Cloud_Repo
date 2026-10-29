// T-024 — exercises the real exported `POST` handler of
// `src/app/api/public/enquiry/route.ts` against the live Supabase instance
// (packet rule: "Exercise the real route handler function"), not a mock.
// `sql` here is test-only fixture setup/teardown, same as every other
// tests/db file — the route itself only ever talks to Postgres through the
// service-role PostgREST client (07 §4).
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

// A deterministic test value so the route's dailySalt() never depends on
// whatever (if anything) .env.local sets for the real cron route.
process.env.CRON_SECRET ??= "test-cron-secret-for-public-enquiry-route";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

async function makeLiveWebsite(institutionId: string): Promise<void> {
  await sql`insert into public.websites (institution_id, is_live) values (${institutionId}, true)`;
}

function enquiryRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/public/enquiry", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

describe("POST /api/public/enquiry (06 §W3, C-80..C-83)", () => {
  it("not_found: unknown slug", async () => {
    const { POST } = await import("@/app/api/public/enquiry/route");
    const res = await POST(
      enquiryRequest({
        slug: "no-such-slug-xyz",
        childName: "A",
        guardianName: "B",
        phone: "9800000001",
        website: "",
      }),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("not_found");
  });

  // Fix round 1 (security review, LOW — no body-size cap).
  it("413: a body over 16 KB is rejected before touching Zod or the DB (content-length fast path)", async () => {
    const { POST } = await import("@/app/api/public/enquiry/route");
    const oversizedMessage = "x".repeat(20 * 1024); // 20 KB — content-length will reflect this
    const res = await POST(
      enquiryRequest({
        slug: "whatever-does-not-need-to-exist",
        childName: "A",
        guardianName: "B",
        phone: "9800000001",
        message: oversizedMessage,
        website: "",
      }),
    );
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("validation_failed");
  });

  it("413: an oversized body is still capped when read as a stream with no content-length header", async () => {
    const { POST } = await import("@/app/api/public/enquiry/route");
    const chunk = new TextEncoder().encode("x".repeat(1024));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 20; i += 1) controller.enqueue(chunk); // 20 KB total, no content-length set
        controller.close();
      },
    });
    const req = new Request("http://localhost/api/public/enquiry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);

    const res = await POST(req);
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("validation_failed");
  });

  it("validation_failed: invalid phone and missing childName return field errors", async () => {
    const { POST } = await import("@/app/api/public/enquiry/route");
    const res = await POST(
      enquiryRequest({ slug: "whatever", childName: "", guardianName: "B", phone: "123", website: "" }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.fieldErrors).toBeDefined();
  });

  it("creates an enquiries row with source='website' and returns a reference", async () => {
    const inst = await createTestInstitution("enquiry-route-ok");
    try {
      await makeLiveWebsite(inst.institutionId);
      const { POST } = await import("@/app/api/public/enquiry/route");

      const res = await POST(
        enquiryRequest({
          slug: inst.slug,
          childName: "Riya Verma",
          guardianName: "Sunita Verma",
          phone: "9800010001",
          website: "",
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.data.reference).toMatch(/^ENQ-/);
      expect(body.data.duplicate).toBe(false);

      const rows = await sql`
        select source, source_ip_hash from public.enquiries where institution_id = ${inst.institutionId}::uuid
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.source).toBe("website");
      // Never the raw IP — only its salted sha256 hex digest.
      expect(rows[0]!.source_ip_hash).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await inst.cleanup();
    }
  });

  it("C-82: resubmitting the same phone/child within 24h returns duplicate:true and inserts no second row", async () => {
    const inst = await createTestInstitution("enquiry-route-dedupe");
    try {
      await makeLiveWebsite(inst.institutionId);
      const { POST } = await import("@/app/api/public/enquiry/route");
      const payload = {
        slug: inst.slug,
        childName: "Kabir Mehta",
        guardianName: "Rohit Mehta",
        phone: "9800020002",
        website: "",
      };

      const first = await POST(enquiryRequest(payload, { "x-forwarded-for": "198.51.100.10" }));
      const firstBody = await first.json();
      expect(firstBody.data.duplicate).toBe(false);

      const second = await POST(enquiryRequest(payload, { "x-forwarded-for": "198.51.100.11" }));
      const secondBody = await second.json();
      expect(second.status).toBe(200);
      expect(secondBody.data.duplicate).toBe(true);
      expect(secondBody.data.reference).toBe(firstBody.data.reference);

      const rows = await sql`
        select count(*) from public.enquiries where institution_id = ${inst.institutionId}::uuid and phone = '9800020002'
      `;
      expect(Number(rows[0]!.count)).toBe(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("C-83: a filled honeypot returns the generic success body and writes no row", async () => {
    const inst = await createTestInstitution("enquiry-route-honeypot");
    try {
      await makeLiveWebsite(inst.institutionId);
      const { POST } = await import("@/app/api/public/enquiry/route");

      const res = await POST(
        enquiryRequest({
          slug: inst.slug,
          childName: "Bot Child",
          guardianName: "Bot Guardian",
          phone: "9800030003",
          website: "http://spam.example", // filled honeypot
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);

      const rows = await sql`
        select id from public.enquiries where institution_id = ${inst.institutionId}::uuid
      `;
      expect(rows).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  });

  it("C-81: the 6th submission from the same ip_hash within an hour is rate_limited", async () => {
    const inst = await createTestInstitution("enquiry-route-ratelimit");
    try {
      await makeLiveWebsite(inst.institutionId);
      const { POST } = await import("@/app/api/public/enquiry/route");
      // Same forwarded-IP header on every call + same CRON_SECRET + same
      // day => the route computes the same ip_hash for all six requests.
      const sameIpHeaders = { "x-forwarded-for": "203.0.113.77" };

      for (let i = 0; i < 5; i += 1) {
        const res = await POST(
          enquiryRequest(
            { slug: inst.slug, childName: `Child ${i}`, guardianName: "Guardian", phone: `98000400${10 + i}`, website: "" },
            sameIpHeaders,
          ),
        );
        expect(res.status).toBe(200);
      }

      const sixth = await POST(
        enquiryRequest(
          { slug: inst.slug, childName: "Child Six", guardianName: "Guardian", phone: "9800040099", website: "" },
          sameIpHeaders,
        ),
      );
      expect(sixth.status).toBe(429);
      const body = await sixth.json();
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("rate_limited");
    } finally {
      await inst.cleanup();
    }
  });

  it("relocks the service-role guard after the call (SERVICE_ROLE_CALLER restored)", async () => {
    const inst = await createTestInstitution("enquiry-route-guard-relock");
    try {
      await makeLiveWebsite(inst.institutionId);
      const before = process.env.SERVICE_ROLE_CALLER;
      const { POST } = await import("@/app/api/public/enquiry/route");

      await POST(
        enquiryRequest({ slug: inst.slug, childName: "Guard Check", guardianName: "G", phone: "9800050005", website: "" }),
      );

      expect(process.env.SERVICE_ROLE_CALLER).toBe(before);
    } finally {
      await inst.cleanup();
    }
  });
});
