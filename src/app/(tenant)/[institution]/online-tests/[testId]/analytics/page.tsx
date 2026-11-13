import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { AppError } from "@/lib/actions/result";
import { getTenantContext } from "@/lib/auth/context";
import { requireModule, requirePermission } from "@/lib/auth/require";
import { uuid } from "@/lib/schemas/common";
import { listCurriculumUnits } from "@/modules/academics/assignments.queries";
import { listTopics } from "@/modules/academics/curriculum.queries";
import { AnalyticsView } from "@/modules/online-tests/components/AnalyticsView";
import { getTest, testAnalytics } from "@/modules/online-tests/queries";

export const metadata: Metadata = { title: "Test analytics" };

export default async function AnalyticsPage({ params }: { params: Promise<{ institution: string; testId: string }> }) {
  const { institution: slug, testId } = await params;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "exams");
  requirePermission(ctx, "online_test.mark");
  if (!uuid.safeParse(testId).success) notFound();
  const notFoundOr = (e: unknown): never => { if (e instanceof AppError && e.code === "not_found") notFound(); throw e; };
  const test = await getTest(ctx, testId).catch(notFoundOr);
  const [data, units, topics] = await Promise.all([
    testAnalytics(ctx, testId).catch(notFoundOr),
    listCurriculumUnits(ctx, { gradeId: test.gradeId, subjectId: test.subjectId }).catch(() => []),
    listTopics(ctx, { gradeId: test.gradeId, subjectId: test.subjectId }).catch(() => []),
  ]);
  const names = Object.fromEntries([...units.map((u) => [u.id, u.title]), ...topics.map((t) => [t.id, t.title])]);
  return (
    <div className="max-w-4xl">
      <PageHeader title={`Analytics: ${test.title}`} crumb="Analytics" back={{ href: `/${slug}/online-tests/${testId}`, label: "Test" }} description="Based on submitted attempts. Marks of written answers count once you save them." />
      <AnalyticsView data={data} topicNames={names} />
    </div>
  );
}
