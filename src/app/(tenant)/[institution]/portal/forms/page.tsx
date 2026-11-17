import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Stagger, StaggerItem } from "@/components/motion";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { requireModule, requirePermission } from "@/lib/auth/require";
import { FormFill } from "@/modules/forms/components/FormFill";
import { formMine } from "@/modules/forms/queries";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";

const PARENT_WORDING = /\b(your child|my child|your ward|my ward|your son|your daughter)\b/i;

export const metadata: Metadata = { title: "Forms" };

export default async function PortalFormsPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ student?: string }>;
}) {
  const { institution: slug } = await params;
  const allParams = await searchParams;
  const { student: studentParam } = allParams;
  const ctx = await getTenantContext(slug);
  if (ctx.membership.role !== "guardian" && ctx.membership.role !== "student") notFound();
  requireModule(ctx, "forms");
  requirePermission(ctx, "form.respond");

  const selection = await resolvePortalSelection(ctx, studentParam, `/${slug}/portal/forms`, allParams);
  const role = ctx.membership.role as "guardian" | "student";
  const nav = <PortalNav institutionSlug={slug} role={role} selection={selection} />;

  let forms;
  try {
    forms = (await formMine(ctx)).filter(
      // shortcut: forms have no audience field (only sections), so parent-addressed wording is the signal; add a real audience column to replace this.
      (f) => f.studentId === selection.studentId && (role === "guardian" || !PARENT_WORDING.test(JSON.stringify([f.title, f.description, f.fields]))),
    );
  } catch (e) {
    console.error("portal forms fetch failed:", e instanceof Error ? e.message : e);
    return (
      <>
        {nav}
        <ErrorState title="Could not load forms" description="Refresh to try again." />
      </>
    );
  }

  return (
    <>
      {nav}
      {forms.length === 0 ? (
        <EmptyState title="No open forms" description="Forms from the school appear here while they are open." />
      ) : (
        <Stagger className="grid gap-4 lg:grid-cols-2 *:min-w-0">
          {forms.map((f) => (
            <StaggerItem key={f.id}>
              <Card className="h-full">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle>{f.title}</CardTitle>
                    {f.responded && <Badge variant="success">Submitted</Badge>}
                  </div>
                  {f.description && <p className="text-sm text-muted-foreground">{f.description}</p>}
                </CardHeader>
                {!f.responded && (
                  <CardContent>
                    <FormFill institutionSlug={slug} formId={f.id} studentId={f.studentId} fields={f.fields} />
                  </CardContent>
                )}
              </Card>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </>
  );
}
