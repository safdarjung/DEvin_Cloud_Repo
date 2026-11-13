import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AppError } from "@/lib/actions/result";
import { getTenantContext } from "@/lib/auth/context";
import { requireModule, requirePermission } from "@/lib/auth/require";
import { uuid } from "@/lib/schemas/common";
import { ExamRunner } from "@/modules/online-tests/components/ExamRunner";
import { getAttemptPaper } from "@/modules/online-tests/queries";

export const metadata: Metadata = { title: "Test" };
export const dynamic = "force-dynamic";

export default async function AttemptPage({ params }: { params: Promise<{ institution: string; attemptId: string }> }) {
  const { institution: slug, attemptId } = await params;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "exams");
  requirePermission(ctx, "online_test.take");
  if (!uuid.safeParse(attemptId).success) notFound();
  const paper = await getAttemptPaper(ctx, attemptId).catch((e) => { if (e instanceof AppError && e.code === "not_found") notFound(); throw e; });
  if (paper.attempt.status !== "in_progress") redirect(`/${slug}/portal/tests/result/${attemptId}`);
  return <ExamRunner slug={slug} paper={paper} />;
}
