import Link from "next/link";
import { CheckCircle2, Circle, MinusCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { SetupStatus } from "@/modules/core/setup/queries";

const LABELS = { structure: "School structure", branding: "Branding", people: "Students and parents", invite: "Invite staff", modules: "Modules" } as const;

/** F18 §H dashboard card. The caller gates it on institution.settings.manage and hides it once `status.complete`. */
export function SetupChecklist({ institutionSlug, status }: { institutionSlug: string; status: SetupStatus }) {
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="text-base">Finish setting up your school</CardTitle>
        <CardDescription>
          {status.completed} of {status.total} steps done.{" "}
          <Link href={`/${institutionSlug}/setup`} className="font-medium underline underline-offset-2">
            Continue setup
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {status.steps.map(({ key, state }) => {
            const Icon = state === "done" ? CheckCircle2 : state === "dismissed" ? MinusCircle : Circle;
            return (
              <li key={key} className="flex items-center gap-1.5">
                <Icon className={`size-4 ${state === "done" ? "text-emerald-600" : "text-muted-foreground"}`} aria-hidden />
                <span>{LABELS[key]}</span>
                <span className="sr-only">{state === "done" ? "done" : state === "dismissed" ? "skipped" : "to do"}</span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
