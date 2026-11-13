import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requireModule, requirePermission } from "@/lib/auth/require";
import { GapsView, RevisionView, TestQuestionsView } from "@/modules/learning/components/InsightsViews";
import { revisionListQuery, sectionGapsQuery, testSectionQuestions } from "@/modules/learning/queries";
import { listTests } from "@/modules/online-tests/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Learning insights" };

const MAX_ASSIGNMENTS = 300;
const selectClass = "h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

interface Pick {
  key: string;
  sectionId: string;
  subjectId: string;
  label: string;
}

async function listPicks(institutionId: string, teacherId: string | null): Promise<Pick[]> {
  const db = await createClient();
  let q = db
    .from("subject_assignments")
    .select("class_section_id, subject_id, class_sections(name, grades(code)), subjects(name)")
    .eq("institution_id", institutionId)
    .limit(MAX_ASSIGNMENTS);
  if (teacherId) q = q.eq("teacher_id", teacherId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? [])
    .map((r) => {
      const sec = r.class_sections as { name: string; grades: { code: string } | null } | null;
      return {
        key: `${r.class_section_id}|${r.subject_id}`,
        sectionId: r.class_section_id,
        subjectId: r.subject_id,
        label: `${sec?.grades?.code ?? "?"}-${sec?.name ?? "?"} · ${(r.subjects as { name: string } | null)?.name ?? "Subject"}`,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "en", { numeric: true }));
}

export default async function LearningInsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ a?: string; test?: string }>;
}) {
  const { institution: slug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "mastery");
  requirePermission(ctx, "mastery.review");
  // 0151 learning_can_view_section: subject teachers and exam leaders only (admin has mastery.review but is refused).
  if (ctx.membership.role === "admin") {
    return (
      <div className="max-w-5xl space-y-8">
        <PageHeader title="Learning insights" description="Chapter and topic gaps, students who need revision, and question-wise test results." />
        <EmptyState title="Not available for your role" description="Learning insights are shown to subject teachers, the exam controller, the principal and the owner." />
      </div>
    );
  }

  const picks = await listPicks(ctx.institution.id, ctx.membership.role === "teacher" ? ctx.membership.staffId : null);
  const pick = picks.find((p) => p.key === sp.a) ?? picks[0];
  const input = pick ? { classSectionId: pick.sectionId, subjectId: pick.subjectId } : null;

  const canTests = hasPermission(ctx, "online_test.manage");
  const [gaps, revision, tests] = input
    ? await Promise.all([
        sectionGapsQuery(ctx, input),
        revisionListQuery(ctx, input),
        canTests ? listTests(ctx, {}).catch(() => []) : Promise.resolve([]),
      ])
    : [null, [], []];
  const sectionTests = tests.filter((t) => pick && t.subjectId === pick.subjectId && t.sectionIds.includes(pick.sectionId));
  const test = sectionTests.find((t) => t.id === sp.test);
  const analytics = test && input ? await testSectionQuestions(ctx, { testId: test.id, classSectionId: input.classSectionId }) : null;

  return (
    <div className="max-w-5xl space-y-8">
      <PageHeader title="Learning insights" description="Chapter and topic gaps, students who need revision, and question-wise test results. Built from practice and released online tests." />
      {!pick ? (
        <EmptyState title="No sections to show" description="You have no subject assignments yet." />
      ) : (
        <>
          <form method="get" className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-xs text-muted-foreground">
              Section and subject
              <select name="a" defaultValue={pick.key} className={selectClass}>
                {picks.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </label>
            <button type="submit" className="min-h-10 rounded-md border px-3 text-sm hover:bg-muted">Show</button>
          </form>

          <section aria-labelledby="li-gaps" className="space-y-2">
            <h2 id="li-gaps" className="text-base font-semibold tracking-tight">Where the class is weak</h2>
            {gaps && <GapsView units={gaps.units} topics={gaps.topics} />}
          </section>

          <section aria-labelledby="li-rev" className="space-y-2">
            <h2 id="li-rev" className="text-base font-semibold tracking-tight">Students needing revision</h2>
            <RevisionView students={revision} />
          </section>

          {canTests && (
            <section aria-labelledby="li-tests" className="space-y-2">
              <h2 id="li-tests" className="text-base font-semibold tracking-tight">Test question analytics</h2>
              {sectionTests.length === 0 ? (
                <p className="text-sm text-muted-foreground">No online tests for this section and subject yet.</p>
              ) : (
                <form method="get" className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="a" value={pick.key} />
                  <label className="grid gap-1 text-xs text-muted-foreground">
                    Test
                    <select name="test" defaultValue={test?.id ?? ""} className={selectClass}>
                      <option value="">Choose a test</option>
                      {sectionTests.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                    </select>
                  </label>
                  <button type="submit" className="min-h-10 rounded-md border px-3 text-sm hover:bg-muted">Show</button>
                </form>
              )}
              {analytics && <TestQuestionsView data={analytics} />}
            </section>
          )}
        </>
      )}
    </div>
  );
}
