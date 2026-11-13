import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { getTenantContext } from "@/lib/auth/context";
import { requireModule, requirePermission } from "@/lib/auth/require";
import { uuid } from "@/lib/schemas/common";
import { inWindow, nowMs } from "@/modules/online-tests/components/test-ui";
import { StartPanel } from "@/modules/online-tests/components/StartPanel";
import { myTests } from "@/modules/online-tests/queries";

export const metadata: Metadata = { title: "Start test" };

export default async function StartTestPage({ params }: { params: Promise<{ institution: string; testId: string }> }) {
  const { institution: slug, testId } = await params;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "exams");
  requirePermission(ctx, "online_test.take");
  if (!uuid.safeParse(testId).success) notFound();
  const test = (await myTests(ctx)).find((t) => t.testId === testId);
  if (!test) notFound();
  const back = { href: `/${slug}/portal/tests`, label: "My tests" };
  return (
    <div className="max-w-2xl">
      <PageHeader title={test.title} crumb={test.title} back={back} />
      {!inWindow(test, nowMs()) && test.openAttemptId === null ? (
        <EmptyState title="This test is not open" description="Come back during the time it is open." />
      ) : (
        <StartPanel slug={slug} test={test} />
      )}
    </div>
  );
}
