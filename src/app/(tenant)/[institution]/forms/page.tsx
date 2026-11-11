import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requireModule } from "@/lib/auth/require";
import { AppError } from "@/lib/actions/result";
import { humanize } from "@/lib/format";
import { listSectionOptions } from "@/modules/exams/queries";
import { FormBuilder, FormStatusButton } from "@/modules/forms/components/FormBuilder";
import { FormFill } from "@/modules/forms/components/FormFill";
import { FormResultsView } from "@/modules/forms/components/FormResultsView";
import { formList, formMine, formResponses, formResults } from "@/modules/forms/queries";
import { aiTaskOn } from "@/modules/ai/task-route";

export const metadata: Metadata = { title: "Forms" };

// Forms. Two jobs gated separately: `form.manage` builds/publishes/closes and reads responses;
// `form.respond` (a teacher) answers forms addressed to the sections they teach.
export default async function FormsPage({ params }: { params: Promise<{ institution: string }> }) {
  const { institution: slug } = await params;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "forms");
  const canManage = hasPermission(ctx, "form.manage");
  const canRespond = hasPermission(ctx, "form.respond");
  if (!canManage && !canRespond) throw new AppError("forbidden", "You do not have access to forms.");
  const ai = { draft: canManage && aiTaskOn(ctx, "form_draft"), translate: aiTaskOn(ctx, "translate") };

  const [formsR, sectionsR, mineR] = await Promise.allSettled([
    canManage ? formList(ctx) : Promise.resolve([]),
    canManage ? listSectionOptions(ctx) : Promise.resolve([]),
    canRespond ? formMine(ctx) : Promise.resolve([]),
  ]);
  for (const r of [formsR, sectionsR, mineR]) if (r.status === "rejected") console.error("forms page fetch failed:", r.reason instanceof Error ? r.reason.message : r.reason);
  const sections = sectionsR.status === "fulfilled" ? sectionsR.value.map((s) => ({ id: s.id, label: s.label })) : [];
  const forms = formsR.status === "fulfilled" ? formsR.value : [];

  // Aggregates + response rows only for forms that can have responses.
  const withResponses = forms.filter((f) => f.status !== "draft" && f.responseCount > 0);
  const detail = await Promise.all(
    withResponses.map(async (f) => {
      try {
        return { id: f.id, results: await formResults(ctx, f.id), rows: await formResponses(ctx, f.id) };
      } catch (e) {
        console.error("forms results failed:", e instanceof Error ? e.message : e);
        return null;
      }
    }),
  );
  const detailById = new Map(detail.flatMap((d) => (d ? [[d.id, d] as const] : [])));
  const sectionLabel = new Map(sections.map((s) => [s.id, s.label]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Forms"
        description={canManage ? "Build consent and information forms, send them to class sections, and read the responses." : "Forms addressed to your classes."}
      />

      {canRespond && (
        <section aria-labelledby="forms-open" className="space-y-3">
          {canManage && (
            <h2 id="forms-open" className="text-base font-semibold">
              Open to me
            </h2>
          )}
          {mineR.status === "rejected" ? (
            <ErrorState title="Could not load your forms" description="Refresh to try again." />
          ) : mineR.value.length === 0 ? (
            <EmptyState title="No open forms" description="Forms the school sends to your classes appear here." />
          ) : (
            mineR.value.map((f) => (
              <Card key={`${f.id}:${f.studentId ?? ""}`}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle>{f.title}</CardTitle>
                    {f.responded && <Badge variant="success">Submitted</Badge>}
                  </div>
                  {f.description && <CardDescription>{f.description}</CardDescription>}
                </CardHeader>
                {!f.responded && (
                  <CardContent>
                    <FormFill institutionSlug={slug} formId={f.id} studentId={f.studentId} fields={f.fields} />
                  </CardContent>
                )}
              </Card>
            ))
          )}
        </section>
      )}

      {canManage && (
        <section aria-labelledby="forms-all" className="space-y-3">
          <h2 id="forms-all" className="text-base font-semibold">
            All forms
          </h2>
          {formsR.status === "rejected" ? (
            <ErrorState title="Could not load forms" description="Refresh to try again." />
          ) : forms.length === 0 ? (
            <EmptyState title="No forms yet" description="Create the first form below. It stays a draft until you publish it." />
          ) : (
            forms.map((f) => {
              const d = detailById.get(f.id);
              return (
                <Card key={f.id}>
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <CardTitle>{f.title}</CardTitle>
                      <div className="flex items-center gap-2">
                        <Badge variant={f.status === "published" ? "success" : "outline"}>{humanize(f.status)}</Badge>
                        {f.status === "draft" && <FormStatusButton institutionSlug={slug} formId={f.id} title={f.title} mode="publish" />}
                        {f.status === "published" && <FormStatusButton institutionSlug={slug} formId={f.id} title={f.title} mode="close" />}
                      </div>
                    </div>
                    <CardDescription>
                      {f.fields.length} field{f.fields.length === 1 ? "" : "s"} · {f.classSectionIds.map((id) => sectionLabel.get(id) ?? "Section").join(", ") || "No audience yet"} ·{" "}
                      {f.responseCount} response{f.responseCount === 1 ? "" : "s"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {f.status === "draft" ? (
                      <details>
                        <summary className="cursor-pointer text-sm font-medium">Edit draft</summary>
                        <div className="pt-3">
                          <FormBuilder institutionSlug={slug} sections={sections} initial={f} ai={ai} />
                        </div>
                      </details>
                    ) : d ? (
                      <FormResultsView institutionSlug={slug} formId={f.id} results={d.results} rows={d.rows} />
                    ) : (
                      <EmptyState bare title="No responses yet" description="Responses appear here as people submit them." />
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
          <Card>
            <CardHeader>
              <CardTitle>New form</CardTitle>
            </CardHeader>
            <CardContent>
              <FormBuilder institutionSlug={slug} sections={sections} ai={ai} />
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}
