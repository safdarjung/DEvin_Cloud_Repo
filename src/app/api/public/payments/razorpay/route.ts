import "server-only";
import { NextResponse } from "next/server";
import { fail, mapSqlError, type ErrorCode } from "@/lib/actions/result";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { RazorpayWebhookSchema, verifyRazorpaySignature } from "@/modules/finance/razorpay";
import { createPaymentsWebhookAdminClient } from "@/modules/finance/with-service-role";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rulings ("Webhook"): cap mirrors readJsonBody's (src/lib/http/request.ts)
// byte ceiling, but at 64 KB and returning raw text, never a parsed body —
// the HMAC signature must be verified before JSON.parse ever runs.
const MAX_BODY_BYTES = 64 * 1024;
const HANDLED_EVENTS = new Set(["payment.captured", "order.paid"]);

// Error map (rulings: "Webhook"). mapSqlError only ever returns `ok: false`
// (06 §1.1) — the `mapped.ok` branch below is unreachable defensive typing,
// same shape as the enquiry route's STATUS_BY_CODE dispatch.
const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  not_found: 404,
  validation_failed: 400,
  conflict: 409,
  invalid_state: 409,
};

function statusForCode(code: ErrorCode): number {
  return STATUS_BY_CODE[code] ?? 500;
}

type RawBodyResult = { ok: true; text: string } | { ok: false };

async function readRawBody(request: Request, maxBytes: number): Promise<RawBodyResult> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false };

  if (!request.body) {
    const text = await request.text();
    return text.length > maxBytes ? { ok: false } : { ok: true, text };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return { ok: false };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(bytes) };
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: { code: "dependency_failed", message: "Payment webhook is not configured." } },
      { status: 503 },
    );
  }

  const bodyResult = await readRawBody(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    return NextResponse.json(
      { ok: false, error: { code: "validation_failed", message: "Request body exceeds 64 KB" } },
      { status: 413 },
    );
  }

  // Never log `bodyResult.text` beyond this point — it carries payer
  // email/phone (rulings: "Webhook").
  const signature = request.headers.get("x-razorpay-signature");
  if (!verifyRazorpaySignature(bodyResult.text, signature, secret)) {
    return NextResponse.json(
      { ok: false, error: { code: "validation_failed", message: "Invalid webhook signature" } },
      { status: 400 },
    );
  }

  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(bodyResult.text);
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "validation_failed", message: "Request body must be JSON" } },
      { status: 400 },
    );
  }

  const parsed = RazorpayWebhookSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { code: "validation_failed", message: "Invalid webhook payload" } },
      { status: 400 },
    );
  }

  const payment = parsed.data.payload.payment?.entity;
  const isHandled =
    HANDLED_EVENTS.has(parsed.data.event) &&
    payment !== undefined &&
    payment.status === "captured" &&
    payment.currency === "INR";

  if (!isHandled) {
    return NextResponse.json({ ok: true, data: { ignored: "event" } });
  }

  try {
    // Service-role client, scoped to this call only (07 §4): the route is
    // the sole caller of `public.record_online_payment`, granted to
    // service_role only. Reused below for the module-gate institution
    // lookup too.
    const admin = createPaymentsWebhookAdminClient();

    const { data: intent, error: intentError } = await admin
      .from("online_payment_intents")
      .select("institution_id")
      .eq("provider_order_id", payment.order_id)
      .maybeSingle();
    if (intentError) {
      const mapped = mapSqlError(intentError);
      return NextResponse.json(mapped, { status: mapped.ok ? 500 : statusForCode(mapped.error.code) });
    }
    if (!intent) {
      return NextResponse.json(fail("not_found", "Payment intent not found."), { status: 404 });
    }

    const { data: institution, error: institutionError } = await admin
      .from("institutions")
      .select("settings")
      .eq("id", intent.institution_id)
      .maybeSingle();
    if (institutionError) {
      const mapped = mapSqlError(institutionError);
      return NextResponse.json(mapped, { status: mapped.ok ? 500 : statusForCode(mapped.error.code) });
    }

    // Modules are packaging, not a security boundary (rulings: "Modules") —
    // institution_id came from the intent row, never from the payload.
    if (
      !institution ||
      !isModuleEnabled({ institution: { settings: institution.settings as Record<string, unknown> } }, "online_payments")
    ) {
      return NextResponse.json({ ok: true, data: { ignored: "module_disabled" } });
    }

    const { data, error } = await admin.rpc("record_online_payment", {
      p_order_id: payment.order_id,
      p_provider_payment_id: payment.id,
      p_amount_paise: payment.amount,
      p_method: payment.method ?? "neft",
    });
    if (error) {
      const mapped = mapSqlError(error);
      return NextResponse.json(mapped, { status: mapped.ok ? 500 : statusForCode(mapped.error.code) });
    }

    // Captured but not bookable (invoice paid/closed since the intent): 200
    // so Razorpay stops retrying; the intent is marked `unreconciled` + audited.
    const result = data as { unreconciled?: boolean; duplicate?: boolean } | null;
    if (result?.unreconciled === true) {
      return NextResponse.json({ ok: true, data: { unreconciled: true, duplicate: result.duplicate === true } });
    }

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    const mapped = mapSqlError(err);
    return NextResponse.json(mapped, { status: mapped.ok ? 500 : statusForCode(mapped.error.code) });
  }
}
