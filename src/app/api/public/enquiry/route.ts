import "server-only";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { mapSqlError, type ErrorCode } from "@/lib/actions/result";
import { clientIp } from "@/modules/website/request-ip";
import { EnquiryInputSchema } from "@/modules/website/schemas";
import { createPublicEnquiryAdminClient } from "@/modules/website/with-service-role";
import { readJsonBody } from "@/lib/http/request";
import { isModuleEnabled } from "@/lib/modules/catalog";

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
    // to `service_role` only — never anon, never authenticated. Reused below
    // for the module-gate lookup too, instead of opening a second, unpooled
    // `postgres()` connection for it (security review fix).
    const admin = createPublicEnquiryAdminClient();

    // Check if admissions module is enabled for this institution before accepting enquiry.
    // Return 404 (same as unknown slug) if module is disabled or the slug is unknown.
    const { data: institution, error: institutionError } = await admin
      .from("institutions")
      .select("settings")
      .eq("slug", slug)
      .maybeSingle();
    if (institutionError) {
      const mapped = mapSqlError(institutionError);
      const status = mapped.ok ? 500 : STATUS_BY_CODE[mapped.error.code] ?? 500;
      return NextResponse.json(mapped, { status });
    }

    if (!institution || !isModuleEnabled({ institution: { settings: institution.settings as Record<string, unknown> } }, "admissions")) {
      return NextResponse.json(
        { ok: false, error: { code: "not_found", message: "Institution not found." } },
        { status: 404 },
      );
    }

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
