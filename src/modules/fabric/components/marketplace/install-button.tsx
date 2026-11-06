"use client";

// F-UI-11 — install/disable lifecycle is `setModuleEnabled` (core/actions.ts),
// the real write path for `institutions.settings.modules`. No marketplace
// install table: non-holders of `institution.settings.manage` get an honest
// "ask an administrator" message instead of a fake pending-approval state.
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { setModuleEnabled } from "@/modules/core/actions";
import type { ModuleListItem } from "@/modules/fabric/marketplace.queries";

export function InstallButton({
  institutionSlug,
  module,
  canManage,
}: {
  institutionSlug: string;
  module: ModuleListItem;
  canManage: boolean;
}) {
  const [enabled, setEnabled] = useState(module.enabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (module.core) {
    return <Badge variant="secondary">Always on</Badge>;
  }

  if (!canManage) {
    return enabled ? (
      <Badge variant="success">Installed</Badge>
    ) : (
      <p className="text-sm text-muted-foreground">Not installed. Ask an administrator to install this module.</p>
    );
  }

  async function handleClick() {
    setSaving(true);
    setError(null);
    const next = !enabled;
    const result = await setModuleEnabled(institutionSlug, { key: module.key, enabled: next });
    if (!result.ok) {
      setError(result.error.message);
    } else {
      setEnabled(result.data.enabled);
    }
    setSaving(false);
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant={enabled ? "outline" : "default"} onClick={handleClick} disabled={saving}>
        {saving ? "Saving…" : enabled ? "Disable" : "Install"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
