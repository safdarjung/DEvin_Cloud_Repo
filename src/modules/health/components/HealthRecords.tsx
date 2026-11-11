import { EmptyState } from "@/components/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { humanize } from "@/lib/format";
import type { HealthProfile, HealthVaccination, HealthVisit } from "@/modules/health/queries";

const dateTime = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const date = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

export function ProfileSummary({ profile }: { profile: HealthProfile | null }) {
  if (!profile) return <EmptyState bare title="No health profile recorded" />;
  const rows: [string, string | null][] = [
    ["Blood group", profile.bloodGroup],
    ["Allergies", profile.allergies],
    ["Conditions", profile.conditions],
    ["Emergency note", profile.emergencyNote],
  ];
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd>{v || "None recorded"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function VisitsTable({ visits, showStudent }: { visits: HealthVisit[]; showStudent?: boolean }) {
  if (visits.length === 0) return <EmptyState bare title="No infirmary visits recorded" />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          {showStudent && <TableHead>Student</TableHead>}
          <TableHead>Complaint</TableHead>
          <TableHead className="hidden sm:table-cell">Treatment</TableHead>
          <TableHead>Outcome</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {visits.map((v) => (
          <TableRow key={v.id}>
            <TableCell className="whitespace-nowrap">{dateTime.format(new Date(v.visitedAt))}</TableCell>
            {showStudent && <TableCell>{v.studentName}</TableCell>}
            <TableCell>{v.complaint}</TableCell>
            <TableCell className="hidden sm:table-cell">{v.treatment ?? "—"}</TableCell>
            <TableCell>{humanize(v.outcome)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function VaccinationsTable({ rows }: { rows: HealthVaccination[] }) {
  if (rows.length === 0) return <EmptyState bare title="No vaccinations recorded" />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Vaccine</TableHead>
          <TableHead>Dose</TableHead>
          <TableHead>Given on</TableHead>
          <TableHead className="hidden sm:table-cell">Notes</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((v) => (
          <TableRow key={v.id}>
            <TableCell className="font-medium">{v.vaccine}</TableCell>
            <TableCell>{v.dose ?? "—"}</TableCell>
            <TableCell>{date.format(new Date(`${v.administeredOn}T00:00:00Z`))}</TableCell>
            <TableCell className="hidden sm:table-cell">{v.notes ?? "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
