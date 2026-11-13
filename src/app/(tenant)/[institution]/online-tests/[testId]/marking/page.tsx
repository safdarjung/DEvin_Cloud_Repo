import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { AppError } from "@/lib/actions/result";
import { getTenantContext } from "@/lib/auth/context";
import { requireModule, requirePermission } from "@/lib/auth/require";
import { uuid } from "@/lib/schemas/common";
import { MarkingView } from "@/modules/online-tests/components/MarkingView";
import { markingQueue } from "@/modules/online-tests/queries";

export const metadata: Metadata = { title: "Mark online test" };

export default async function MarkingPage({ params }: { params: Promise<{ institution: string; testId: string }> }) {
  const { institution: slug, testId } = await params;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "exams");
  requirePermission(ctx, "online_test.mark");
  if (!uuid.safeParse(testId).success) notFound();
  const queue = await markingQueue(ctx, testId).catch((e) => { if (e instanceof AppError && e.code === "not_found") notFound(); throw e; });
  return (
    <div className="max-w-4xl">
      <PageHeader title={`Marking: ${queue.test.title}`} crumb="Marking" back={{ href: `/${slug}/online-tests/${testId}`, label: "Test" }} description="Objective answers are already marked. Mark the written answers, then finalise each attempt." />
      <MarkingView slug={slug} queue={queue} />
    </div>
  );
}
