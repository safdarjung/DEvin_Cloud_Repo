"use client";

// F-UI-04 — student success roster: search/filter/sort over the real
// StudentSuccessRow[] the server already loaded (no per-filter round trip —
// the dataset is one institution's enrolled students). Row click opens the
// drawer; Export writes the currently filtered rows as CSV.
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/states";
import { Stagger, StaggerItem } from "@/components/motion";
import { downloadFile, toCsv } from "@/modules/fabric/components/download";
import type { InterventionPlan, StudentSuccessRow } from "@/modules/fabric/types";
import { filterRoster } from "./filters";
import { RiskChip, TrendIcon } from "./shared";
import { StudentDrawer } from "./student-drawer";
import { SupportQueue } from "./support-queue";

const RISK_FILTERS = ["all", "watch", "support"] as const;
type RiskFilter = (typeof RISK_FILTERS)[number];

export function StudentRoster({
  institutionSlug,
  rows,
  sections,
  plans,
  canReview,
  initialSection = "all",
  initialRisk = "all",
  initialSearch = "",
}: {
  institutionSlug: string;
  rows: StudentSuccessRow[];
  sections: { id: string; label: string }[];
  plans: InterventionPlan[];
  canReview: boolean;
  initialSection?: string;
  initialRisk?: RiskFilter;
  initialSearch?: string;
}) {
  const [search, setSearch] = useState(initialSearch);
  const [section, setSection] = useState(initialSection);
  const [risk, setRisk] = useState<RiskFilter>(initialRisk);
  const [hasGaps, setHasGaps] = useState(false);
  const [selected, setSelected] = useState<StudentSuccessRow | null>(null);

  const sectionLabels = useMemo(() => [...new Set(sections.map((s) => s.label))].sort(), [sections]);

  const filtered = useMemo(
    () =>
      filterRoster(rows, {
        search,
        section: section === "all" ? undefined : section,
        risk: risk === "all" ? undefined : risk,
        hasGaps,
      }),
    [rows, search, section, risk, hasGaps],
  );

  function exportCsv(): void {
    downloadFile(
      "student-success.csv",
      toCsv(
        filtered.map((r) => ({
          name: r.name,
          section: r.section_label,
          attendance_pct: r.attendance_pct,
          mastery_pct: r.mastery_pct,
          trend: r.trend,
          risk: r.risk,
          support_owner: r.support_owner ?? "",
          last_contact: r.last_contact ?? "",
        })),
      ),
      "text/csv",
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or gap topic…"
          className="w-56"
          aria-label="Search students"
        />
        <Select value={section} onValueChange={setSection}>
          <SelectTrigger className="w-40" aria-label="Filter by section">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sections</SelectItem>
            {sectionLabels.map((label) => (
              <SelectItem key={label} value={label}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-1">
          {RISK_FILTERS.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={risk === r}
              onClick={() => setRisk(r)}
              className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Badge variant={risk === r ? "default" : "outline"}>{r === "all" ? "All" : r === "watch" ? "Watch" : "Support"}</Badge>
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={hasGaps}
          onClick={() => setHasGaps((v) => !v)}
          className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Badge variant={hasGaps ? "default" : "outline"}>Has gaps</Badge>
        </button>
        <Button type="button" variant="outline" size="sm" className="ml-auto gap-1.5" onClick={exportCsv} disabled={filtered.length === 0}>
          <Download className="size-4" aria-hidden />
          Export CSV
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No students match these filters" description="Try clearing the search, section, or risk filter." />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <TableCaption>Student roster: attendance, mastery, trend, and risk from live records</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Section</TableHead>
                  <TableHead>Attendance</TableHead>
                  <TableHead>Mastery</TableHead>
                  <TableHead>Trend</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>Support owner</TableHead>
                  <TableHead>Last contact</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <TableRow key={row.student_id} className="cursor-pointer" onClick={() => setSelected(row)}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>{row.section_label}</TableCell>
                    <TableCell className="tabular-nums">{row.attendance_pct}%</TableCell>
                    <TableCell className="tabular-nums">{row.mastery_pct}%</TableCell>
                    <TableCell>
                      <TrendIcon trend={row.trend} />
                    </TableCell>
                    <TableCell>
                      <RiskChip risk={row.risk} />
                    </TableCell>
                    <TableCell>{row.support_owner ?? "—"}</TableCell>
                    <TableCell>{row.last_contact ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <Stagger className="grid gap-3 md:hidden">
            {filtered.map((row) => (
              <StaggerItem key={row.student_id}>
                <button
                  type="button"
                  onClick={() => setSelected(row)}
                  className="w-full rounded-xl border p-3 text-left ring-1 ring-foreground/10"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{row.name}</span>
                    <RiskChip risk={row.risk} />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {row.section_label} · Attendance {row.attendance_pct}% · Mastery {row.mastery_pct}%
                  </p>
                </button>
              </StaggerItem>
            ))}
          </Stagger>
        </>
      )}

      <section aria-label="Support queue" className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Support queue</h2>
        <SupportQueue rows={rows} onSelect={setSelected} />
      </section>

      <StudentDrawer
        institutionSlug={institutionSlug}
        student={selected}
        plans={plans}
        canReview={canReview}
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </div>
  );
}
