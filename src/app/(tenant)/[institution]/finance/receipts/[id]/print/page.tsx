import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { ReceiptView } from "@/modules/finance/components/ReceiptView";
import { getReceipt } from "@/modules/finance/queries";

// T-032 — 06 §W9 (AC1: "print view has no nav"). This route is still
// nested under the tenant layout (src/app/(tenant)/[institution]/layout.tsx
// — out of this packet's file list, not touched), which always renders
// `<header>`/`<nav aria-label="Primary">` around `children` — Next.js App
// Router layouts cannot be "unwrapped" by a descendant page. The `<style>`
// tag below is the minimal, zero-file-touch way to actually hide them on
// print: a plain `@media print` rule targeting those two elements by their
// existing tag/attribute, scoped to this one route by only ever rendering
// on this page. The on-screen "Back"/nothing controls are also
// `print:hidden` so only the receipt itself reaches paper.
export default async function ReceiptPrintPage({
  params,
}: {
  params: Promise<{ institution: string; id: string }>;
}) {
  const { institution: institutionSlug, id } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "finance.read");

  const receipt = await getReceipt(ctx, id);
  if (!receipt) notFound();

  return (
    <div className="mx-auto max-w-2xl">
      <style>{`
        @media print {
          header, nav[aria-label="Primary"] { display: none !important; }
        }
      `}</style>
      <div className="print:hidden mb-4">
        <Button variant="outline" asChild>
          <Link href={`/${institutionSlug}/finance/receipts/${id}`}>Back</Link>
        </Button>
      </div>
      <ReceiptView receipt={receipt} />
    </div>
  );
}
