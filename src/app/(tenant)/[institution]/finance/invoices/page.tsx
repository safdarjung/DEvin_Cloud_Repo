import { ListPager } from "@/components/list-pager";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { humanize } from "@/lib/format";
import { parsePage } from "@/lib/list-search";
import { GenerateInvoicesPanel } from "@/modules/finance/components/GenerateInvoicesPanel";
import { InvoiceTable } from "@/modules/finance/components/InvoiceTable";
import { listGradeOptions, listInvoicesPage, listTermOptions } from "@/modules/finance/queries";

const STATUSES = ["issued", "part_paid", "paid", "cancelled"] as const;
const SELECT_CLASS = "h-10 rounded-[15px] border border-input bg-transparent px-3 text-sm";

export default async function InvoicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ termId?: string; gradeId?: string; status?: string; q?: string; page?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "finance.read");

  const canGenerate = hasPermission(ctx, "finance.invoice.generate");
  const status = STATUSES.find((s) => s === sp.status);
  const pageNum = parsePage(sp.page);
  const [result, terms, grades] = await Promise.all([
    listInvoicesPage(ctx, { termId: sp.termId || undefined, gradeId: sp.gradeId || undefined, status, q: sp.q, page: pageNum }),
    listTermOptions(ctx),
    listGradeOptions(ctx),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader title="Invoices" description="Term invoices and their payment status." back={{ href: `/${institutionSlug}/finance`, label: "Finance" }} />
      {canGenerate && <GenerateInvoicesPanel institutionSlug={institutionSlug} terms={terms} grades={grades} />}
      <form method="get" className="flex flex-wrap items-center gap-2">
        <Input name="q" defaultValue={sp.q ?? ""} placeholder="Search by invoice no, student name or admission no" aria-label="Search invoices" className="max-w-sm" />
        <select name="termId" defaultValue={sp.termId ?? ""} aria-label="Filter by term" className={SELECT_CLASS}>
          <option value="">All terms</option>
          {terms.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <select name="gradeId" defaultValue={sp.gradeId ?? ""} aria-label="Filter by grade" className={SELECT_CLASS}>
          <option value="">All grades</option>
          {grades.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={status ?? ""} aria-label="Filter by status" className={SELECT_CLASS}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {humanize(s)}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>
      <InvoiceTable institutionSlug={institutionSlug} invoices={result.rows} serverFiltered />
      <ListPager
        basePath={`/${institutionSlug}/finance/invoices`}
        params={{ q: sp.q, termId: sp.termId, gradeId: sp.gradeId, status }}
        page={pageNum}
        total={result.total}
        pageSize={result.pageSize}
        noun="invoices"
      />
    </div>
  );
}
