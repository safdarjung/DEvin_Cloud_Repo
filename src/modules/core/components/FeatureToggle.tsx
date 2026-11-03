"use client";

// D30/D33 — the only UI for toggling `institutions.settings.features.*`.
// Shown to owner/principal/admin (who hold `institution.settings.manage`).
// Generalized from a `teacher_ai_agent`-only toggle (Bug A fix) so each new
// feature key doesn't need its own copy of this component.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { FeatureKey } from "@/lib/auth/entitlements";
import type { ModuleKey } from "@/lib/modules/catalog";
import { setFeatureEnabled, setModuleEnabled } from "@/modules/core/actions";

interface FeatureToggleProps {
  institutionSlug: string;
  featureKey: FeatureKey;
  label: string;
  initialEnabled: boolean;
  kind?: "feature";
}

interface ModuleToggleProps {
  institutionSlug: string;
  featureKey: ModuleKey;
  label: string;
  initialEnabled: boolean;
  kind: "module";
}

type FeatureToggleAllProps = FeatureToggleProps | ModuleToggleProps;

export function FeatureToggle(props: FeatureToggleAllProps) {
  const { institutionSlug, featureKey, label, initialEnabled, kind = "feature" } = props;
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle() {
    setSaving(true);
    setError(null);
    const next = !enabled;
    const action = kind === "module" ? setModuleEnabled : setFeatureEnabled;
    const result = await action(institutionSlug, { key: featureKey, enabled: next });
    if (!result.ok) {
      setError(result.error.message);
    } else {
      setEnabled(result.data.enabled);
    }
    setSaving(false);
  }

  return (
    <div className="space-y-2 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">{label}</h2>
          <p className="text-muted-foreground text-xs">
            {enabled
              ? kind === "module"
                ? "Enabled for this school."
                : "Included in this school's plan."
              : kind === "module"
                ? "Disabled for this school."
                : "Not included in this school's plan."}
          </p>
        </div>
        <Button type="button" variant={enabled ? "outline" : "default"} onClick={handleToggle} disabled={saving}>
          {saving ? "Saving…" : enabled ? "Disable" : "Enable"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
