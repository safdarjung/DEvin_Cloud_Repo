"use client";
// F-UI-08 scenario list: save/load/delete/propose/approve/reject/compare —
// saved_scenarios (20261028000106) replaces the demo store as the source
// of truth. Approve/reject buttons only render for owner/principal (the
// server-side gate in fabric.simulator.decide is the real enforcement —
// this hides the control for roles it would just reject, CLAUDE.md rule 2).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/states";
import type { Role } from "@/lib/auth/permissions";
import type { BaselineFacts } from "@/modules/fabric/demo/simulator";
import {
  createScenario,
  decideScenario,
  deleteScenario,
  updateScenario,
} from "@/modules/fabric/simulator.actions";
import type { SavedScenario } from "@/modules/fabric/simulator.queries";
import type { ScenarioAssumptions } from "@/modules/fabric/types";
import { CompareView } from "./compare-view";

const STATUS_VARIANT: Record<SavedScenario["status"], "secondary" | "default" | "destructive"> = {
  draft: "secondary",
  proposed: "default",
  approved: "default",
  rejected: "destructive",
};

export function ScenarioList({
  institutionSlug,
  scenarios,
  currentAssumptions,
  activeId,
  role,
  facts,
  onLoad,
}: {
  institutionSlug: string;
  scenarios: SavedScenario[];
  currentAssumptions: ScenarioAssumptions;
  activeId: string | null;
  role: Role;
  facts: BaselineFacts;
  onLoad: (scenario: SavedScenario) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const [rationale, setRationale] = useState("");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const canDecide = role === "owner" || role === "principal";

  function run(promise: Promise<{ ok: boolean; error?: { message: string } }>, successMessage: string) {
    startTransition(async () => {
      const result = await promise;
      if (result.ok) {
        toast.success(successMessage);
        router.refresh();
      } else {
        toast.error(result.error?.message ?? "Something went wrong.");
      }
    });
  }

  function handleSave() {
    if (!name.trim()) return;
    run(
      createScenario(institutionSlug, { name: name.trim(), rationale: rationale.trim(), assumptions: currentAssumptions }),
      "Scenario saved as draft.",
    );
    setSaveOpen(false);
    setName("");
    setRationale("");
  }

  function toggleCompare(id: string) {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1]!, id];
      return [...prev, id];
    });
  }

  const compareScenarios =
    compareIds.length === 2
      ? ([scenarios.find((s) => s.id === compareIds[0]), scenarios.find((s) => s.id === compareIds[1])].filter(
          Boolean,
        ) as SavedScenario[])
      : [];

  return (
    <div className="space-y-4">
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            Save as…
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save scenario</DialogTitle>
            <DialogDescription>Saves the current sliders as a draft. Nothing changes for the school yet.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="mb-1 block" htmlFor="scenario-name">
                Name
              </Label>
              <Input id="scenario-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
            </div>
            <div>
              <Label className="mb-1 block" htmlFor="scenario-rationale">
                Rationale
              </Label>
              <Textarea
                id="scenario-rationale"
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                maxLength={500}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" onClick={handleSave} disabled={!name.trim() || pending}>
              Save draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {scenarios.length === 0 ? (
        <EmptyState title="No saved scenarios yet" description="Save your first scenario to compare it against the baseline later." />
      ) : (
        <ul className="space-y-2">
          {scenarios.map((s) => (
            <li key={s.id} className={`rounded-lg border p-3 ${activeId === s.id ? "border-primary" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      aria-label={`Select ${s.name} to compare`}
                      checked={compareIds.includes(s.id)}
                      onChange={() => toggleCompare(s.id)}
                    />
                    <p className="truncate font-medium">{s.name}</p>
                    <Badge variant={STATUS_VARIANT[s.status]}>{s.status}</Badge>
                  </div>
                  {s.rationale && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{s.rationale}</p>}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => onLoad(s)}>
                  Load
                </Button>
                {s.status === "draft" && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => run(updateScenario(institutionSlug, { id: s.id, status: "proposed" }), "Proposed for approval.")}
                    >
                      Propose
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => {
                        if (window.confirm(`Delete "${s.name}"? This cannot be undone.`)) {
                          run(deleteScenario(institutionSlug, { id: s.id }), "Scenario deleted.");
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </>
                )}
                {s.status === "proposed" && canDecide && (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      disabled={pending}
                      onClick={() => run(decideScenario(institutionSlug, { id: s.id, decision: "approved" }), "Scenario approved.")}
                    >
                      Approve
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={pending}
                      onClick={() => run(decideScenario(institutionSlug, { id: s.id, decision: "rejected" }), "Scenario rejected.")}
                    >
                      Reject
                    </Button>
                  </>
                )}
              </div>
              {s.status === "proposed" && (
                <p className="mt-2 text-xs text-muted-foreground">Awaiting principal approval — nothing changes until approved.</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {compareScenarios.length === 2 && (
        <div>
          <p className="mb-2 text-sm font-medium">Comparing 2 scenarios</p>
          <CompareView scenarios={[compareScenarios[0]!, compareScenarios[1]!]} facts={facts} />
        </div>
      )}
    </div>
  );
}
