import type { Metadata } from "next";
import { FadeIn } from "@/components/motion";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requireModule, requirePermission } from "@/lib/auth/require";
import { inr } from "@/lib/format";
import { cn } from "cn";
import { libraryMyLoans } from "@/modules/library/queries";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";
import { fmtIsoDate } from "@/modules/people/portal-dates";

export const metadata: Metadata = { title: "Library" };

const th = "px-3 py-2 text-left font-medium";
const td = "px-3 py-2";

export default async function PortalLibraryPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ student?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const allParams = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requireModule(ctx, "library");
  requirePermission(ctx, "library.read");

  const selection = await resolvePortalSelection(ctx, allParams.student, `/${institutionSlug}/portal/library`, allParams);
  const loans = await libraryMyLoans(ctx, { studentId: selection.studentId });
  const issued = loans.filter((l) => !l.returnedOn);
  const returned = loans.filter((l) => l.returnedOn);

  return (
    <>
      <PortalNav
        institutionSlug={institutionSlug}
        role={ctx.membership.role as "guardian" | "student"}
        selection={selection}
        activeHref=""
        canStudy={hasPermission(ctx, "ai.study")}
      />
      <FadeIn key={selection.studentId} className="space-y-6">
        <section aria-labelledby="issued-h">
          <h2 id="issued-h" className="mb-2 text-base font-semibold">Currently issued</h2>
          {issued.length === 0 ? (
            <EmptyState title="No books issued" description="Books borrowed from the school library appear here." />
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th scope="col" className={th}>Book</th>
                    <th scope="col" className={th}>Issued</th>
                    <th scope="col" className={th}>Due</th>
                    <th scope="col" className={th}>Fine so far</th>
                  </tr>
                </thead>
                <tbody>
                  {issued.map((l) => (
                    <tr key={l.loanId} className={cn("border-b last:border-0", l.daysOverdue > 0 && "bg-destructive/5")}>
                      <td className={td}>
                        <span className="block font-medium">{l.title}</span>
                        <span className="block text-xs text-muted-foreground">{l.accessionNo}</span>
                      </td>
                      <td className={td}>{fmtIsoDate(l.issuedOn)}</td>
                      <td className={td}>
                        {fmtIsoDate(l.dueOn)}{" "}
                        {l.daysOverdue > 0 && <Badge variant="destructive">{l.daysOverdue} day{l.daysOverdue === 1 ? "" : "s"} overdue</Badge>}
                      </td>
                      <td className={td}>{l.fine > 0 ? inr(l.fine) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="history-h">
          <h2 id="history-h" className="mb-2 text-base font-semibold">Return history</h2>
          {returned.length === 0 ? (
            <EmptyState title="No returned books yet" />
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th scope="col" className={th}>Book</th>
                    <th scope="col" className={th}>Issued</th>
                    <th scope="col" className={th}>Returned</th>
                    <th scope="col" className={th}>Fine</th>
                  </tr>
                </thead>
                <tbody>
                  {returned.map((l) => (
                    <tr key={l.loanId} className="border-b last:border-0">
                      <td className={cn(td, "font-medium")}>{l.title}</td>
                      <td className={td}>{fmtIsoDate(l.issuedOn)}</td>
                      <td className={td}>{l.returnedOn ? fmtIsoDate(l.returnedOn) : "—"}</td>
                      <td className={td}>{l.fine > 0 ? inr(l.fine) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </FadeIn>
    </>
  );
}
