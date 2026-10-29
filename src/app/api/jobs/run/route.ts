import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createRunnerPorts, runOnceCore } from "@/modules/jobs/runner";
import { createJobsAdminClient } from "@/modules/jobs/with-service-role";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fixed-length (32-byte) digests make `timingSafeEqual` safe to call
// unconditionally — it throws on a length mismatch, which a naive
// `a.length === b.length` guard would otherwise leak via early return.
function secretsMatch(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false; // never authorize when the secret is unset

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!provided) return false;

  return secretsMatch(provided, expected);
}

async function handle(request: NextRequest): Promise<Response> {
  // Reject before touching the DB (packet security requirement).
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    // Service-role client only — never a direct Postgres connection (07 §4):
    // `createJobsAdminClient` scopes `SERVICE_ROLE_CALLER` to this call only.
    const admin = createJobsAdminClient();
    const ports = createRunnerPorts(admin);
    const workerId = `route-${crypto.randomUUID()}`;
    const summary = await runOnceCore({ workerId }, ports);
    return NextResponse.json(summary);
  } catch (err) {
    const correlationId = crypto.randomUUID();
    console.error(`[${correlationId}] /api/jobs/run failed`, err);
    return NextResponse.json({ error: "internal", correlationId }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request);
}

export async function GET(request: NextRequest): Promise<Response> {
  return handle(request);
}
