import { ShieldAlert, ShieldCheck } from "lucide-react";
import type { SafetyWarning } from "@/modules/school-labs/safety";
import { LabSafetyNoteButton } from "@/modules/ai/components/LabSafetyNoteButton";

const REASON_LABEL = { expired: "Expired", hazard: "Hazard", out_of_stock: "Out of stock" } as const;

/** Deterministic lab safety check. Text labels carry the meaning; colour is only decoration. `ai` (capability on) adds "Summarise". */
export function SafetyCheck({ labName, warnings, ai }: { labName: string; warnings: SafetyWarning[]; ai?: { institutionSlug: string; labId: string } }) {
  return (
    <section aria-label="Safety check" className="rounded-md border p-3 text-sm">
      <h3 className="flex items-center gap-2 font-semibold">
        {warnings.length === 0 ? <ShieldCheck className="size-4" aria-hidden /> : <ShieldAlert className="size-4 text-destructive" aria-hidden />}
        Safety check
      </h3>
      {warnings.length === 0 ? (
        <p className="mt-1 text-muted-foreground">{labName}: nothing expired, hazard-classed or out of stock.</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {warnings.map((w) => (
            <li key={w.equipmentId}>
              <span className="mr-1 font-medium">[{w.reasons.map((r) => REASON_LABEL[r]).join(", ")}]</span>
              {w.text}
            </li>
          ))}
        </ul>
      )}
      {ai && warnings.length > 0 && <LabSafetyNoteButton institutionSlug={ai.institutionSlug} labId={ai.labId} />}
    </section>
  );
}
