import { AppError } from "@/lib/actions/result";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/require";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { getLayoutBranding } from "@/modules/core/setup/branding.queries";
import { renderPaperHtml } from "@/modules/question-papers/html";
import { getPaper } from "@/modules/question-papers/queries";
import { PrintKindSchema, PrintSetSchema } from "@/modules/question-papers/schemas";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Printable question paper / answer key / marking scheme:
// ?paper=<id>&kind=paper|key|scheme&set=A|B|C|D. Same walls as certificates/print:
// permission + RLS (getPaper reads as the caller), every value escaped, and a
// CSP with no scripts. The only remote image allowed is the school's logo origin.
function headers(logoUrl: string | null): Record<string, string> {
  const logoOrigin = logoUrl ? ` ${new URL(logoUrl).origin}` : "";
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; img-src data:${logoOrigin}; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

const text = (body: string, status: number) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(request: Request, { params }: { params: Promise<{ institution: string }> }) {
  const { institution } = await params;
  const url = new URL(request.url);
  const id = url.searchParams.get("paper");
  const kind = PrintKindSchema.safeParse(url.searchParams.get("kind") ?? "paper");
  const set = PrintSetSchema.safeParse(url.searchParams.get("set") ?? "A");
  if (!id || !UUID_RE.test(id) || !kind.success || !set.success) return text("Bad request", 400);

  try {
    const ctx = await getTenantContext(institution);
    if (!isModuleEnabled(ctx, "question_bank")) return text("Not found", 404);
    if (!hasPermission(ctx, "question.manage")) return text("Forbidden", 403);
    const paper = await getPaper(ctx, id);
    if (!paper) return text("Not found", 404);
    const { logoUrl } = await getLayoutBranding(ctx);
    const html = renderPaperHtml({ schoolName: ctx.institution.name, logoUrl, paper, kind: kind.data, set: set.data });
    return new Response(html, { headers: headers(logoUrl) });
  } catch (e) {
    if (e instanceof AppError) return text(e.code === "unauthenticated" ? "Sign in required" : "Not available", e.code === "unauthenticated" ? 401 : 403);
    console.error("question paper print failed:", e instanceof Error ? e.message : e);
    return text("Could not render", 500);
  }
}
