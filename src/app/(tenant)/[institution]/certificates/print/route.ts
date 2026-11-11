import { AppError } from "@/lib/actions/result";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/require";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { certificateHtml } from "@/modules/certificates/queries";
import { idCardsHtml } from "@/modules/certificates/id-cards.queries";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Printable certificate (?cert=<id>) or ID-card sheet (?section=<id>). The HTML is generated
// server-side with every user value escaped (escapeHtml); the CSP is a second wall that blocks
// scripts and network, so the document can never run code even if an escape were missed.
const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

const text = (body: string, status: number) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(request: Request, { params }: { params: Promise<{ institution: string }> }) {
  const { institution } = await params;
  const url = new URL(request.url);
  const cert = url.searchParams.get("cert");
  const section = url.searchParams.get("section");
  const id = cert ?? section;
  if (!id || !UUID_RE.test(id) || (cert && section)) return text("Bad request", 400);

  try {
    const ctx = await getTenantContext(institution);
    if (!isModuleEnabled(ctx, "certificates")) return text("Not found", 404);
    if (!hasPermission(ctx, "certificate.manage")) return text("Forbidden", 403);
    const result = cert ? await certificateHtml(ctx, cert) : await idCardsHtml(ctx, section as string);
    if (!result) return text("Not found", 404);
    return new Response(result.html, { headers: HEADERS });
  } catch (e) {
    if (e instanceof AppError) return text(e.code === "unauthenticated" ? "Sign in required" : "Not available", e.code === "unauthenticated" ? 401 : 403);
    console.error("certificates print failed:", e instanceof Error ? e.message : e);
    return text("Could not render", 500);
  }
}
