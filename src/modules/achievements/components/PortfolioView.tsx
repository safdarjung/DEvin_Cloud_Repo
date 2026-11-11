import { Badge } from "@/components/ui/badge";
import { humanize } from "@/lib/format";
import type { Portfolio } from "@/modules/achievements/queries";
import { PrintButton } from "./AchievementForms";

// Print layout: the app chrome (nav, sidebar, header) is hidden when printing; status is also
// written as text ("Verified" / "Not yet verified") so a black-and-white print stays unambiguous.
export function PortfolioView({ portfolio, schoolName }: { portfolio: Portfolio; schoolName: string }) {
  return (
    <article aria-label={`Achievement portfolio of ${portfolio.studentName}`} className="space-y-4">
      <style>{"@media print { nav, aside, header { display: none !important; } }"}</style>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-xs">{schoolName}</p>
          <h2 className="text-xl font-semibold">Achievement portfolio: {portfolio.studentName}</h2>
          {portfolio.admissionNo && <p className="text-muted-foreground text-sm">Admission no {portfolio.admissionNo}</p>}
        </div>
        <PrintButton />
      </div>
      {portfolio.entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">No achievements recorded yet.</p>
      ) : (
        <ol className="space-y-3">
          {portfolio.entries.map((e) => (
            <li key={e.id} className="break-inside-avoid rounded-md border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">{e.title}</p>
                <p className="text-muted-foreground text-xs tabular-nums">{e.eventDate}</p>
              </div>
              <p className="text-sm">
                {humanize(e.category)}, {humanize(e.level)} level{e.position ? `, ${e.position}` : ""}
              </p>
              {e.description && <p className="mt-1 text-sm">{e.description}</p>}
              <p className="mt-1">
                <Badge variant={e.verified ? "success" : "outline"}>{e.verified ? "Verified" : "Not yet verified"}</Badge>
              </p>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}
