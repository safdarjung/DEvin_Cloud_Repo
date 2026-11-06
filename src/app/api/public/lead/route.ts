import "server-only";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { mapSqlError, type ErrorCode } from "@/lib/actions/result";
import { readJsonBody } from "@/lib/http/request";
import { LeadInputSchema } from "@/lib/marketing/lead-schema";
import { clientIp } from "@/modules/website/request-ip";
import { createPublicEnquiryAdminClient } from "@/modules/website/with-service-role";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;
const SUCCESS_MESSAGE = "Thanks. We have your request and will be in touch.";

const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  validation_failed: 400,
  rate_limited: 429,
};

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function internal(): Response {
  const correlationId = crypto.randomUUID();
  return NextResponse.json(
    { ok: false, error: { code: "internal", message: `Something went wrong. Reference: ${correlationId}` } },
    { status: 500 },
  );
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) {
    return NextResponse.json(
      { ok: false, error: { code: "validation_failed", message: body.tooLarge ? "Request body exceeds 16 KB" : "Request body must be JSON" } },
      { status: body.tooLarge ? 413 : 400 },
    );
  }

  const parsed = LeadInputSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { code: "validation_failed", message: "Invalid request", fieldErrors: parsed.error.flatten().fieldErrors } },
      { status: 400 },
    );
  }

  const { website: honeypot, ...payload } = parsed.data;
  // Filled honeypot: pretend success, store nothing, spend no rate-limit slot.
  if (honeypot !== "") return NextResponse.json({ ok: true, data: { message: SUCCESS_MESSAGE } });

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("/api/public/lead misconfigured: CRON_SECRET missing");
    return internal();
  }
  const salt = sha256Hex(`${secret}:${new Date().toISOString().slice(0, 10)}`);
  const ipHash = sha256Hex(clientIp(request) + salt);

  try {
    const admin = createPublicEnquiryAdminClient();
    const { data, error } = await admin.rpc("submit_platform_lead", { p_payload: payload, p_ip_hash: ipHash });
    if (error) {
      const mapped = mapSqlError(error);
      const status = mapped.ok ? 500 : STATUS_BY_CODE[mapped.error.code] ?? 500;
      return NextResponse.json(mapped, { status });
    }
    void data; // dedupe outcome stays server-side: same response either way, so emails can't be probed
    return NextResponse.json({ ok: true, data: { message: SUCCESS_MESSAGE } });
  } catch (err) {
    const mapped = mapSqlError(err);
    const status = mapped.ok ? 500 : STATUS_BY_CODE[mapped.error.code] ?? 500;
    return NextResponse.json(mapped, { status });
  }
}
