import Link from "next/link";
import { EmptyState } from "@/components/states";
import type { DashboardDTO } from "@/modules/core/dashboard.queries";
import { AttendanceChart } from "./AttendanceChart";
import { Section } from "./Section";

export function AttendanceSection({ data, basePath, showAtRisk = true }: { data: DashboardDTO; basePath: string; showAtRisk?: boolean }) {
  const { attendanceToday, sectionsAtRisk } = data;
  return (
    <div className={showAtRisk ? "grid gap-4 lg:grid-cols-2" : undefined}>
      <Section title="Attendance today">
        <AttendanceChart presentWeighted={attendanceToday.presentWeighted} totalInDenominator={attendanceToday.totalInDenominator} />
      </Section>
      {showAtRisk && (
        <Section title="Sections below threshold today">
          {sectionsAtRisk.length === 0 ? (
            <EmptyState title="All sections above threshold" description="No section is below the critical attendance threshold today." />
          ) : (
            <ul className="space-y-1 text-sm">
              {sectionsAtRisk.map((section) => (
                <li key={section.classSectionId} className="flex justify-between gap-2 border-b border-border py-1 last:border-0">
                  <Link href={`${basePath}/attendance/${section.classSectionId}`} className="hover:underline">
                    {section.label}
                  </Link>
                  <span className="font-medium tabular-nums">{section.percentage}%</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </div>
  );
}
