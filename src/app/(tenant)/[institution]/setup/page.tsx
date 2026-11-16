import type { Metadata } from "next";
import { CheckCircle2, Circle, MinusCircle } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import type { SetupStep } from "@/modules/core/schemas";
import { isModuleEnabled, OPTIONAL_MODULE_KEYS } from "@/lib/modules/catalog";
import { StepBranding } from "@/modules/core/setup/components/StepBranding";
import { StepInvite } from "@/modules/core/setup/components/StepInvite";
import { StepModules } from "@/modules/core/setup/components/StepModules";
import { StepPeople } from "@/modules/core/setup/components/StepPeople";
import { ImportMappingSuggest } from "@/modules/ai/components/ImportMappingSuggest";
import { aiTaskOn } from "@/modules/ai/task-route";
import { StepStructure } from "@/modules/core/setup/components/StepStructure";
import { getSetupStatus, type SetupStepState } from "@/modules/core/setup/queries";
import { defaultYearStart } from "@/modules/core/setup/templates";

export const metadata: Metadata = { title: "School setup" };

// F18 §H — setup wizard shell; each step is its own component.
const STEPS: Record<SetupStep, { title: string; description: string }> = {
  structure: { title: "1. School structure", description: "Year, terms, grades, sections, subjects, bell times and a draft fee structure." },
  branding: { title: "2. Branding", description: "Optional. Logo and primary colour for your school's pages." },
  people: { title: "3. Students and parents", description: "Upload your student list from a spreadsheet." },
  invite: { title: "4. Invite staff", description: "Optional. Send sign-in invitations to your teachers and office staff." },
  modules: { title: "5. Modules", description: "Optional. Everything useful is already on; change it any time." },
};

const STATE_ICON: Record<SetupStepState, { icon: typeof Circle; label: string; className: string }> = {
  done: { icon: CheckCircle2, label: "Done", className: "text-emerald-600" },
  dismissed: { icon: MinusCircle, label: "Skipped", className: "text-muted-foreground" },
  todo: { icon: Circle, label: "To do", className: "text-muted-foreground" },
};

export default async function SetupPage({ params }: { params: Promise<{ institution: string }> }) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "institution.settings.manage");

  const status = await getSetupStatus(ctx);
  const enabledModules = Object.fromEntries(OPTIONAL_MODULE_KEYS.map((key) => [key, isModuleEnabled(ctx, key)]));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Set up your school"
        description={`${status.completed} of ${status.total} steps done. Steps 1 and 3 get you going; the rest can wait.`}
      />
      {status.steps.map(({ key, state }) => {
        const { icon: Icon, label, className } = STATE_ICON[state];
        return (
          <Card key={key}>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-base">{STEPS[key].title}</CardTitle>
                  <CardDescription>{STEPS[key].description}</CardDescription>
                </div>
                <span className={`flex shrink-0 items-center gap-1.5 text-xs font-medium ${className}`}>
                  <Icon className="size-4" aria-hidden />
                  {label}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              {key === "structure" && (
                <StepStructure
                  institutionSlug={institutionSlug}
                  state={state}
                  gradeCount={status.counts.grades}
                  yearStart={status.currentYearStart ?? defaultYearStart()}
                />
              )}
              {key === "branding" && (
                <StepBranding
                  institutionSlug={institutionSlug}
                  state={state}
                  institutionId={ctx.institution.id}
                  logoPath={status.branding.logoPath}
                  primaryColor={status.branding.primaryColor}
                />
              )}
              {key === "people" && (
                <StepPeople
                  institutionSlug={institutionSlug}
                  state={state}
                  studentCount={status.counts.students}
                  gradeCount={status.counts.grades}
                  aiMappingSlot={aiTaskOn(ctx, "import_mapping") ? <ImportMappingSuggest institutionSlug={institutionSlug} /> : undefined}
                />
              )}
              {key === "invite" && <StepInvite institutionSlug={institutionSlug} state={state} invitationCount={status.counts.invitations} />}
              {key === "modules" && (
                <StepModules institutionSlug={institutionSlug} state={state} studentCount={status.counts.students} enabled={enabledModules} />
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
