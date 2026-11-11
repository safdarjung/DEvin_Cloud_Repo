"use client";

// T6 (ai-roles) — one tab per membership role, settings/ai/page.tsx's client
// half. The server page resolves everything (roleAiConfig, capabilityState,
// usageByRole); this component only renders that data and calls
// `setAiRoleConfig` on save, same split as FeatureToggle.tsx.
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import type { Role } from "@/lib/auth/permissions";
import type { CapabilityData, CapabilityKey, CapabilityKind } from "@/modules/ai/capabilities/catalog";
import { setAiRoleConfig } from "@/modules/core/actions";
import type { AiRoleConfig } from "@/modules/core/schemas";
import { AssistantPanel } from "@/modules/ai/components/AssistantPanel";

export interface RoleTabCapability {
  key: CapabilityKey;
  label: string;
  description: string;
  kind: CapabilityKind;
  data: CapabilityData;
  on: boolean;
  /** null = unlocked; otherwise a plain reason to show, already worded by the server page. */
  lockReason: string | null;
  /** "role" means this role never gets the capability at all — the row is hidden, not greyed. */
  hideRow: boolean;
}

export interface RoleTabConfig {
  enabled: boolean;
  cloud: boolean;
  instructions: string;
  dailyTokenQuota: number | null;
}

export interface RoleTabData {
  role: Role;
  label: string;
  config: RoleTabConfig;
  usage: { tokens: number; costPaise: number };
  capabilities: RoleTabCapability[];
}

const CLOUD_WARNING =
  "When on, this role's AI may use Groq or Gemini. Phone numbers, emails and ID numbers are masked first.";

export function AiRoleSettings({ institutionSlug, roles }: { institutionSlug: string; roles: RoleTabData[] }) {
  if (roles.length === 0) return null;
  return (
    <Tabs defaultValue={roles[0].role}>
      <TabsList className="h-auto flex-wrap">
        {roles.map((r) => (
          <TabsTrigger key={r.role} value={r.role}>
            {r.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {roles.map((r) => (
        <TabsContent key={r.role} value={r.role} className="mt-4">
          <RoleTab institutionSlug={institutionSlug} data={r} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

function RoleTab({ institutionSlug, data }: { institutionSlug: string; data: RoleTabData }) {
  const [config, setConfig] = useState(data.config);
  const [instructionsDraft, setInstructionsDraft] = useState(data.config.instructions);
  const [quotaDraft, setQuotaDraft] = useState(data.config.dailyTokenQuota?.toString() ?? "");
  const [capabilities, setCapabilities] = useState(data.capabilities);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: AiRoleConfig, savingKey: string): Promise<boolean> {
    setSaving(savingKey);
    setError(null);
    const result = await setAiRoleConfig(institutionSlug, { role: data.role, patch });
    setSaving(null);
    if (!result.ok) {
      setError(result.error.message);
      return false;
    }
    return true;
  }

  async function toggleEnabled() {
    const next = !config.enabled;
    if (await save({ enabled: next }, "enabled")) setConfig((c) => ({ ...c, enabled: next }));
  }

  async function toggleCloud() {
    const next = !config.cloud;
    if (await save({ cloud: next }, "cloud")) setConfig((c) => ({ ...c, cloud: next }));
  }

  async function saveInstructions() {
    if (await save({ instructions: instructionsDraft }, "instructions")) {
      setConfig((c) => ({ ...c, instructions: instructionsDraft }));
    }
  }

  async function saveQuota() {
    const trimmed = quotaDraft.trim();
    if (trimmed === "") return; // shortcut: blank never clears a stored quota; no clear action yet.
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < 0) {
      setError("Daily token limit must be a whole number, 0 or more.");
      return;
    }
    if (await save({ daily_token_quota: parsed }, "quota")) {
      setConfig((c) => ({ ...c, dailyTokenQuota: parsed }));
    }
  }

  async function toggleCapability(cap: RoleTabCapability) {
    const next = !cap.on;
    if (await save({ capabilities: { [cap.key]: next } }, cap.key)) {
      setCapabilities((prev) => prev.map((c) => (c.key === cap.key ? { ...c, on: next } : c)));
    }
  }

  const chatTools = capabilities.filter((c) => c.kind === "chat_tool" && !c.hideRow);
  const pageTasks = capabilities.filter((c) => c.kind === "task" && !c.hideRow);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>AI for {data.label}</CardTitle>
          <CardDescription>This role&rsquo;s overall AI chat switch, cloud use, instructions and usage limit.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ToggleRow
            label="AI chat"
            description={config.enabled ? "On for this role." : "Off for this role. Page tasks below still work."}
            on={config.enabled}
            saving={saving === "enabled"}
            onToggle={toggleEnabled}
          />
          <ToggleRow label="May use cloud AI" description={CLOUD_WARNING} on={config.cloud} saving={saving === "cloud"} onToggle={toggleCloud} />

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor={`instructions-${data.role}`}>
              School instructions for this role
            </label>
            <Textarea
              id={`instructions-${data.role}`}
              value={instructionsDraft}
              maxLength={500}
              onChange={(e) => setInstructionsDraft(e.target.value)}
              placeholder="Optional notes the AI should keep in mind for this role."
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{instructionsDraft.length}/500</span>
              <Button type="button" size="sm" variant="outline" disabled={saving === "instructions"} onClick={saveInstructions}>
                {saving === "instructions" ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor={`quota-${data.role}`}>
              Daily token limit
            </label>
            <div className="flex items-center gap-2">
              <Input
                id={`quota-${data.role}`}
                type="number"
                min={0}
                value={quotaDraft}
                onChange={(e) => setQuotaDraft(e.target.value)}
                placeholder="No limit"
                className="max-w-40"
              />
              <Button type="button" size="sm" variant="outline" disabled={saving === "quota"} onClick={saveQuota}>
                {saving === "quota" ? "Saving…" : "Save"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Leave blank for no daily limit.</p>
          </div>

          <div className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
            Usage this month: {data.usage.tokens.toLocaleString("en-IN")} tokens, ₹{(data.usage.costPaise / 100).toFixed(2)} estimated.
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Chat tools</CardTitle>
          <CardDescription>What this role&rsquo;s AI chat can look up or do.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {chatTools.length === 0 && <p className="text-sm text-muted-foreground">No chat tools available for this role.</p>}
          {chatTools.map((cap) => (
            <CapabilityRow key={cap.key} cap={cap} saving={saving === cap.key} onToggle={() => toggleCapability(cap)} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Page tasks</CardTitle>
          <CardDescription>AI features on other pages. These keep working even when AI chat above is off.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {pageTasks.length === 0 && <p className="text-sm text-muted-foreground">No page tasks available for this role.</p>}
          {pageTasks.map((cap) => (
            <CapabilityRow key={cap.key} cap={cap} saving={saving === cap.key} onToggle={() => toggleCapability(cap)} />
          ))}
        </CardContent>
      </Card>

      <TestAsRole institutionSlug={institutionSlug} role={data.role} label={data.label} capabilities={capabilities} />
    </div>
  );
}

// T7 — chat preview as this role: runs through the same `handleAiChat`
// (`previewRole` field), as the signed-in viewer's own permissions/RLS, not
// as the previewed role. `own`-data capabilities (a student's/guardian's
// own record) have no "own" record to scope to here, so they're never part
// of the preview — named below rather than silently missing.
function TestAsRole({
  institutionSlug,
  role,
  label,
  capabilities,
}: {
  institutionSlug: string;
  role: Role;
  label: string;
  capabilities: RoleTabCapability[];
}) {
  const skippedOwn = capabilities.filter((c) => c.kind === "chat_tool" && c.on && !c.hideRow && c.data === "own");
  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle>Test as {label}</CardTitle>
        <CardDescription>
          Chat as you, using {label.toLowerCase()}&rsquo;s persona and chat tools. Runs with your own permissions and data access, not theirs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {skippedOwn.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Skipped in preview (no own student/child to scope to): {skippedOwn.map((c) => c.label).join(", ")}.
          </p>
        )}
        <AssistantPanel
          institutionSlug={institutionSlug}
          previewRole={role}
          prompts={[]}
          placeholder={`Ask as ${label.toLowerCase()}…`}
        />
      </CardContent>
    </Card>
  );
}

function ToggleRow({
  label,
  description,
  on,
  saving,
  onToggle,
}: {
  label: string;
  description: string;
  on: boolean;
  saving: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Button type="button" size="sm" variant={on ? "outline" : "default"} disabled={saving} onClick={onToggle}>
        {saving ? "Saving…" : on ? "Turn off" : "Turn on"}
      </Button>
    </div>
  );
}

function CapabilityRow({
  cap,
  saving,
  onToggle,
}: {
  cap: RoleTabCapability;
  saving: boolean;
  onToggle: () => void;
}) {
  const disabled = cap.lockReason !== null;
  return (
    <div className={`flex items-center justify-between gap-4 rounded-lg border border-border p-3 ${disabled ? "opacity-60" : ""}`}>
      <div>
        <p className="text-sm font-medium">{cap.label}</p>
        <p className="text-xs text-muted-foreground">{cap.description}</p>
        {cap.lockReason && <p className="mt-1 text-xs text-warning">{cap.lockReason}</p>}
      </div>
      <Button type="button" size="sm" variant={cap.on ? "outline" : "default"} disabled={saving || disabled} onClick={onToggle}>
        {saving ? "Saving…" : cap.on ? "Turn off" : "Turn on"}
      </Button>
    </div>
  );
}
