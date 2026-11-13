import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { getTenantContext } from "@/lib/auth/context";
import { requireModule, requirePermission } from "@/lib/auth/require";
import { listLabelledTeachableSections } from "@/modules/academics/assignments.queries";
import { TestCreateForm } from "@/modules/online-tests/components/TestCreateForm";
import { listPapers } from "@/modules/question-papers/queries";
import { PaperListSchema } from "@/modules/question-papers/schemas";

export const metadata: Metadata = { title: "New online test" };

export default async function NewOnlineTestPage({ params }: { params: Promise<{ institution: string }> }) {
  const { institution: slug } = await params;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "exams");
  requirePermission(ctx, "online_test.manage");

  const [{ items }, sections] = await Promise.all([
    listPapers(ctx, PaperListSchema.parse({ status: "published", pageSize: 100 })),
    listLabelledTeachableSections(ctx),
  ]);
  if (items.length === 0) {
    return (
      <div className="max-w-3xl">
        <PageHeader title="New online test" />
        <EmptyState
          title="No published papers"
          description="An online test is set from a published question paper. Build and publish one first."
          action={<Button asChild><Link href={`/${slug}/question-papers`}>Question papers</Link></Button>}
        />
      </div>
    );
  }
  return (
    <div className="max-w-3xl">
      <PageHeader title="New online test" description="Pick a published paper and the classes that sit it. You schedule it on the next page." />
      <TestCreateForm
        institutionSlug={slug}
        papers={items.map((p) => ({ id: p.id, title: p.title, gradeId: p.gradeId, label: `${p.title} (${p.gradeCode} ${p.subjectName}, ${p.totalMarks} marks)`, currentVersion: p.currentVersion }))}
        sections={sections}
      />
    </div>
  );
}
