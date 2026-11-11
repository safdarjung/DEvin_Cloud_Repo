"use client";

// F18 §H step 5: recommended bundle by student count over the real catalog; each
// module toggles through core.module.set. No billing exists, so prices are indicative (§F).
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LimitedBadge } from "@/components/honesty";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import { formatPriceInr, MODULES, monthlyTotalInr, PRICE_NOTE, type OptionalModuleKey } from "@/lib/modules/catalog";
import { setModuleEnabled } from "@/modules/core/actions";
import { setProgress } from "@/modules/core/setup/actions";
import { BUNDLE_TIERS, BUNDLES, recommendedTier, type BundleTier } from "@/modules/core/setup/bundles";
import type { SetupStepState } from "@/modules/core/setup/queries";

const SELECT_CLASS = "h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm";
const TIER_LABEL: Record<BundleTier, string> = { small: "Small school (under 300 students)", medium: "Medium school (300 to 999)", large: "Large school (1000 or more)" };

interface StepModulesProps {
  institutionSlug: string;
  state: SetupStepState;
  /** Optional additions (page passes them): drives the recommendation. */
  studentCount?: number;
  /** Whether each optional module is on now (isModuleEnabled on the server). */
  enabled?: Partial<Record<OptionalModuleKey, boolean>>;
}

export function StepModules({ institutionSlug, state, studentCount = 0, enabled: initial = {} }: StepModulesProps) {
  const router = useRouter();
  const recommended = recommendedTier(studentCount);
  const [tier, setTier] = useState<BundleTier>(recommended);
  const [enabled, setEnabled] = useState(initial);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Same helper the marketplace uses; every optional key is present, so catalog defaults never apply.
  const total = monthlyTotalInr({ institution: { settings: { modules: enabled } } });

  async function toggle(key: OptionalModuleKey, next: boolean): Promise<boolean> {
    setPendingKey(key);
    setError(null);
    const res = await setModuleEnabled(institutionSlug, { key, enabled: next });
    setPendingKey(null);
    if (!res.ok) {
      setError(`${MODULES[key].label}: ${describeActionError(res.error)}`);
      return false;
    }
    setEnabled((prev) => ({ ...prev, [key]: res.data.enabled }));
    return true;
  }

  async function enableBundle() {
    for (const key of BUNDLES[tier]) {
      if (enabled[key]) continue;
      if (!(await toggle(key, true))) return;
    }
  }

  async function finish(next: "done" | "dismissed" | "todo") {
    setPendingKey("step");
    const res = await setProgress(institutionSlug, { step: "modules", state: next });
    setPendingKey(null);
    if (!res.ok) return setError(describeActionError(res.error));
    router.refresh();
  }

  const busy = pendingKey !== null;
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1.5 sm:max-w-sm">
        <Label htmlFor="modules-tier">Bundle{tier === recommended ? " (recommended for your school)" : ""}</Label>
        <select id="modules-tier" className={SELECT_CLASS} value={tier} disabled={busy} onChange={(e) => setTier(e.target.value as BundleTier)}>
          {BUNDLE_TIERS.map((t) => (
            <option key={t} value={t}>
              {TIER_LABEL[t]}
              {t === recommended ? " (recommended)" : ""}
            </option>
          ))}
        </select>
      </div>

      <ul className="divide-y divide-border rounded-lg border border-border">
        {BUNDLES[tier].map((key) => (
          <li key={key} className="flex items-center justify-between gap-3 p-3 text-sm">
            <label className="flex min-w-0 items-center gap-2">
              <input type="checkbox" checked={enabled[key] === true} disabled={busy} onChange={(e) => void toggle(key, e.target.checked)} className="size-4" />
              <span className="truncate">{MODULES[key].label}</span>
            </label>
            <span className="shrink-0 text-muted-foreground">{formatPriceInr(MODULES[key].priceInr)}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Monthly total for installed modules: {formatPriceInr(total)}</span>
        <LimitedBadge />
        <span className="text-xs text-muted-foreground">{PRICE_NOTE}</span>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={enableBundle} disabled={busy}>
          Turn on this whole bundle
        </Button>
        <Button onClick={() => finish("done")} disabled={busy}>
          Done choosing
        </Button>
        <Button variant="ghost" onClick={() => finish(state === "dismissed" ? "todo" : "dismissed")} disabled={busy}>
          {state === "dismissed" ? "Resume this step" : "Skip for now"}
        </Button>
      </div>
    </div>
  );
}
