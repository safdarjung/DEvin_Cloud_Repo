import { EmptyState } from "@/components/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { FormResults } from "@/modules/forms/queries";

const dt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Aggregates (name-free) + a response table + CSV link. All answer text renders as React text. */
export function FormResultsView({
  institutionSlug,
  formId,
  results,
  rows,
}: {
  institutionSlug: string;
  formId: string;
  results: FormResults;
  rows: Record<string, string>[];
}) {
  const csv = `/api/v1/query/form.responses?format=csv&institution=${encodeURIComponent(institutionSlug)}&input=${encodeURIComponent(JSON.stringify({ formId }))}`;
  if (results.responseCount === 0) return <EmptyState bare title="No responses yet" description="Responses appear here as people submit them." />;
  const columns = Object.keys(rows[0] ?? {}).filter((k) => k !== "submittedAt");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p>
          {results.responseCount} response{results.responseCount === 1 ? "" : "s"} · {results.audienceStudents} students in the audience
        </p>
        <a href={csv} className="text-sm font-medium underline underline-offset-2" download>
          Export CSV
        </a>
      </div>
      <ul className="space-y-2 text-sm">
        {results.fields.map((f) => (
          <li key={f.index} className="rounded-md border p-3">
            <p className="font-medium">{f.label}</p>
            {f.options && (
              <ul className="mt-1 text-muted-foreground">
                {f.options.map((o) => (
                  <li key={o.label}>
                    {o.label}: <span className="tabular-nums">{o.count}</span>
                  </li>
                ))}
              </ul>
            )}
            {f.consentGiven !== undefined && (
              <p className="mt-1 text-muted-foreground">
                Consent given <span className="tabular-nums">{f.consentGiven}</span> · pending <span className="tabular-nums">{f.consentPending}</span>
              </p>
            )}
            {f.type === "text" && <p className="mt-1 text-muted-foreground">{f.answered} answered</p>}
          </li>
        ))}
      </ul>
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c}>{c}</TableHead>
            ))}
            <TableHead>Submitted</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>
              {columns.map((c) => (
                <TableCell key={c}>{r[c]}</TableCell>
              ))}
              <TableCell className="tabular-nums">{dt.format(new Date(r.submittedAt))}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
