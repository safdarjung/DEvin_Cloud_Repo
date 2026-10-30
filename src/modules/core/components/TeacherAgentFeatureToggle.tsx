"use client";

// D30/D33 — the only UI for toggling `institutions.settings.features
// .teacher_ai_agent`. Shown to owner/principal/admin (who hold
// `institution.settings.manage`) on the page teachers otherwise use the
// agent from, so the effect of the toggle is visible in context.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { setFeatureEnabled } from "@/modules/core/actions";

interface TeacherAgentFeatureToggleProps {
  institutionSlug: string;
  initialEnabled: boolean;
}

export function TeacherAgentFeatureToggle({ institutionSlug, initialEnabled }: TeacherAgentFeatureToggleProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle() {
    setSaving(true);
    setError(null);
    const next = !enabled;
    const result = await setFeatureEnabled(institutionSlug, { key: "teacher_ai_agent", enabled: next });
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
          <h2 className="text-sm font-semibold">Teacher AI assistant</h2>
          <p className="text-muted-foreground text-xs">
            {enabled ? "Included in this school's plan." : "Not included in this school's plan."}
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
