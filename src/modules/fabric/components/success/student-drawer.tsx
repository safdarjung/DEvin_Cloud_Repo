"use client";

// F-UI-04 — roster row -> drawer. Progress/Gaps/Interventions are all real
// data (mastery module, M20); "Suggest practice" is omitted (no staff path
// exists to assign practice to a specific student — practice is self-serve
// via src/modules/practice, not assignable), per the students-lane brief.
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/states";
import type { InterventionPlan, StudentSuccessRow } from "@/modules/fabric/types";
import { InterventionEditor } from "./intervention-editor";
import { RiskChip, StatTile, TrendIcon } from "./shared";

export function StudentDrawer({
  institutionSlug,
  student,
  plans,
  canReview,
  open,
  onOpenChange,
}: {
  institutionSlug: string;
  student: StudentSuccessRow | null;
  plans: InterventionPlan[];
  canReview: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const studentPlans = student ? plans.filter((p) => p.student_id === student.student_id) : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {student && (
          <>
            <SheetHeader>
              <SheetTitle>{student.name}</SheetTitle>
              <SheetDescription className="flex items-center gap-2">
                {student.section_label}
                <RiskChip risk={student.risk} />
              </SheetDescription>
            </SheetHeader>

            <Tabs defaultValue="progress" className="mt-4 px-4">
              <TabsList>
                <TabsTrigger value="progress">Progress</TabsTrigger>
                <TabsTrigger value="gaps">Gaps</TabsTrigger>
                <TabsTrigger value="interventions">Interventions</TabsTrigger>
              </TabsList>

              <TabsContent value="progress" className="space-y-3 pt-3">
                <div className="grid grid-cols-2 gap-3">
                  <StatTile label="Attendance" value={`${student.attendance_pct}%`} />
                  <StatTile label="Mastery" value={`${student.mastery_pct}%`} />
                </div>
                <p className="flex items-center gap-1 text-sm text-muted-foreground">
                  <TrendIcon trend={student.trend} />
                  Trend: {student.trend} (last two published exams)
                </p>
                {student.flags.length > 0 && (
                  <ul className="flex flex-wrap gap-1">
                    {student.flags.map((f) => (
                      <li key={f}>
                        <Badge variant="secondary">{f}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>

              <TabsContent value="gaps" className="pt-3">
                {student.gaps.length === 0 ? (
                  <EmptyState title="No gaps detected" description="This student has no mastery gaps below threshold." />
                ) : (
                  <ul className="space-y-2">
                    {student.gaps.map((g) => (
                      <li key={`${g.subject}:${g.topic}`} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                        <span>
                          {g.subject} · {g.topic}
                        </span>
                        <span className="tabular-nums text-muted-foreground">{g.mastery_pct}%</span>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>

              <TabsContent value="interventions" className="space-y-3 pt-3">
                <p className="text-sm text-muted-foreground">Plans are proposed automatically by the mastery-gap detector, not created here.</p>
                {studentPlans.length === 0 ? (
                  <EmptyState title="No intervention plan" description="None proposed for this student yet." />
                ) : (
                  studentPlans.map((plan) => (
                    <InterventionEditor key={plan.id} institutionSlug={institutionSlug} plan={plan} canEdit={canReview} />
                  ))
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
