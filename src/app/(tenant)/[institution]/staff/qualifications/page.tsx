import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { QualificationRulesForm } from "@/modules/people/components/QualificationRulesForm";
import { classWise, eligibleGrades, LEVEL_SHORT, sortTeachers } from "@/modules/people/qualifications";
import { listClassesAndSubjects, listTeacherQualifications, qualificationRules } from "@/modules/people/queries";

export const metadata: Metadata = { title: "Teacher qualifications" };

// 0155: teachers sorted by qualification, and for each class who may teach it, so the office can
// share classes out. Qualifications come from each teacher's own profile (first sign-in form).
export default async function TeacherQualificationsPage({ params }: { params: Promise<{ institution: string }> }) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "staff.read");
  const { grades, subjects } = await listClassesAndSubjects(ctx);
  const rules = qualificationRules(ctx);
  const teachers = sortTeachers(await listTeacherQualifications(ctx, subjects));
  const byClass = classWise(teachers, grades, rules);
  const gradeName = new Map(grades.map((g) => [g.id, g.displayName]));
  const missing = teachers.filter((t) => !t.onboarded).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Teacher qualifications"
        description={`${teachers.length} teachers, highest qualification first.${missing ? ` ${missing} have not filled in their profile yet; they see a reminder when they sign in.` : ""}`}
      />

      {hasPermission(ctx, "institution.settings.manage") && (
        <Card>
          <CardHeader>
            <CardTitle>Who may teach which classes</CardTitle>
            <CardDescription>The highest class each qualification level may teach. Everyone below that class is included.</CardDescription>
          </CardHeader>
          <CardContent>
            <QualificationRulesForm institutionSlug={institutionSlug} rules={rules} grades={grades} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>By teacher</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Teacher</TableHead>
                <TableHead>Highest</TableHead>
                <TableHead>Degrees</TableHead>
                <TableHead>May teach up to</TableHead>
                <TableHead>Asked for</TableHead>
                <TableHead>Subjects</TableHead>
                <TableHead className="text-right">Years</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teachers.map((t) => (
                <TableRow key={t.staffId}>
                  <TableCell className="font-medium">
                    {t.name}
                    <span className="block text-xs font-normal text-muted-foreground">{t.designation}</span>
                  </TableCell>
                  <TableCell>{t.level ? <Badge variant="secondary">{LEVEL_SHORT[t.level]}</Badge> : <Badge variant="warning">Profile not filled</Badge>}</TableCell>
                  <TableCell className="max-w-56 text-sm">{t.degrees || "—"}</TableCell>
                  <TableCell>{eligibleGrades(t.level, rules, grades).at(-1)?.displayName ?? "—"}</TableCell>
                  <TableCell className="max-w-48 text-sm">{t.gradeIds.map((id) => gradeName.get(id)).filter(Boolean).join(", ") || "—"}</TableCell>
                  <TableCell className="max-w-48 text-sm">{t.subjectNames.join(", ") || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.experienceYears ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>By class</CardTitle>
          <CardDescription>For each class: teachers qualified for it who asked for it, then others qualified for it.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {byClass.map(({ grade, preferred, alsoQualified }) => (
            <div key={grade.id} className="rounded-lg border border-border p-3 text-sm">
              <p className="font-semibold">{grade.displayName}</p>
              <p className="mt-1">
                <span className="text-muted-foreground">Asked for it: </span>
                {preferred.map((t) => t.name).join(", ") || "nobody yet"}
              </p>
              <p className="mt-1">
                <span className="text-muted-foreground">Also qualified: </span>
                {alsoQualified.map((t) => t.name).join(", ") || "—"}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
