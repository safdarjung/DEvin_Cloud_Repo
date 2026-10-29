import "server-only";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { mapSqlError, type ErrorCode } from "@/lib/actions/result";
import { clientIp } from "@/modules/website/request-ip";
import { EnquiryInputSchema } from "@/modules/website/schemas";
import { createPublicEnquiryAdminClient } from "@/modules/website/with-service-role";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GENERIC_SUCCESS_MESSAGE = "Thank you; the admissions office will call you.";

// Only codes `app.submit_public_enquiry` can actually raise (06 §W3) get a
// specific status; anything else is `internal` either way.
const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  validation_failed: 400,
  not_found: 404,
  rate_limited: 429,
};

// Fix round 1 (security review, LOW): caps the request body so a bot can't
// tie up the handler (or the rate-limit table) with an oversized payload
// before Zod even gets to look at it.
const MAX_BODY_BYTES = 16 * 1024;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** `sha256(CRON_SECRET + yyyy-mm-dd)` — rotates daily so `ip_hash` values from different days never collide (packet rule; CRON_SECRET reused per the packet's own documented assumption, no new env var). */
function dailySalt(): string {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET is not configured");
  const today = new Date().toISOString().slice(0, 10);
  return sha256Hex(`${secret}:${today}`);
}

type BodyReadResult = { ok: true; data: unknown } | { ok: false; tooLarge: boolean };

/**
 * Fix round 1 (security review, LOW): caps the body at `MAX_BODY_BYTES`
 * before it ever reaches `JSON.parse`. `content-length` is checked first
 * as a fast path, but it's a client-supplied header too — can be absent or
 * wrong — so the stream itself is also read with a hard byte ceiling,
 * never trusting the header alone.
 */
async function readJsonBody(request: Request, maxBytes: number): Promise<BodyReadResult> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, tooLarge: true };
  }

  if (!request.body) {
    try {
      const text = await request.text();
      return { ok: true, data: text.length > 0 ? JSON.parse(text) : undefined };
    } catch {
      return { ok: false, tooLarge: false };
    }
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, tooLarge: true };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, tooLarge: false };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder().decode(bytes);
    return { ok: true, data: text.length > 0 ? JSON.parse(text) : undefined };
  } catch {
    return { ok: false, tooLarge: false };
  }
}

export async function POST(request: Request): Promise<Response> {
  const bodyResult = await readJsonBody(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    if (bodyResult.tooLarge) {
      return NextResponse.json(
        { ok: false, error: { code: "validation_failed", message: "Request body exceeds 16 KB" } },
        { status: 413 },
      );
    }
    return NextResponse.json(
      { ok: false, error: { code: "validation_failed", message: "Request body must be JSON" } },
      { status: 400 },
    );
  }

  const parsed = EnquiryInputSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "validation_failed",
          message: "Invalid enquiry",
          fieldErrors: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  const { slug, website: honeypot, ...payload } = parsed.data;

  // C-83: a filled honeypot gets the normal success body and nothing is
  // written — no SQL call, no row, no rate-limit slot consumed. A human
  // never sees or fills this hidden field.
  if (honeypot !== "") {
    return NextResponse.json({ ok: true, data: { message: GENERIC_SUCCESS_MESSAGE, duplicate: false } });
  }

  let ipHash: string;
  try {
    ipHash = sha256Hex(clientIp(request) + dailySalt());
  } catch (err) {
    const correlationId = crypto.randomUUID();
    console.error(`[${correlationId}] /api/public/enquiry misconfigured`, err);
    return NextResponse.json(
      { ok: false, error: { code: "internal", message: `Something went wrong. Reference: ${correlationId}` } },
      { status: 500 },
    );
  }

  try {
    // Service-role client, scoped to this call only (07 §4): the route is
    // the sole caller of `public.submit_public_enquiry`, which is granted
    // to `service_role` only — never anon, never authenticated.
    const admin = createPublicEnquiryAdminClient();
    const { data, error } = await admin.rpc("submit_public_enquiry", {
      p_slug: slug,
      p_payload: payload,
      p_ip_hash: ipHash,
    });

    if (error) {
      const mapped = mapSqlError(error);
      const status = mapped.ok ? 500 : STATUS_BY_CODE[mapped.error.code] ?? 500;
      return NextResponse.json(mapped, { status });
    }

    const result = data as { enquiry_id: string; reference: string; duplicate: boolean };
    return NextResponse.json({
      ok: true,
      data: {
        message: GENERIC_SUCCESS_MESSAGE,
        reference: result.reference,
        duplicate: result.duplicate,
      },
    });
  } catch (err) {
    const mapped = mapSqlError(err);
    const status = mapped.ok ? 500 : STATUS_BY_CODE[mapped.error.code] ?? 500;
    return NextResponse.json(mapped, { status });
  }
}
