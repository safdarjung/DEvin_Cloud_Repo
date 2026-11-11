"use client";

// Control centre: one place to switch modules, features and the AI orb on and off.
// Every write is one of the existing core.* actions. Saves run one at a time
// (the handlers rewrite the whole settings JSON, so two in flight could lose a write).
import { Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Role } from "@/lib/auth/permissions";
import { setAiRoleConfig, setFeatureEnabled, setModuleEnabled } from "@/modules/core/actions";
import { applyCall, callsFor, inverseCall, type Call } from "@/modules/core/control-centre/changes";
import { PRESETS, presetPatch, previewPatch, resetPatch, type Preset } from "@/modules/core/control-centre/presets";
import {
  buildAiTree, buildSystemTree, countOn, filterTree, fixLabel, moduleOffImpact, roleChatOn, roleName,
  type CcModel, type CcSettings, type Control, type Fix, type StatusFilter, type TreeNode,
} from "@/modules/core/control-centre/state";
import { cn } from "cn";
import { TreeView, type RowSave } from "./TreeView";

interface Props {
  slug: string;
  model: CcModel;
  initialSettings: CcSettings;
  roles: readonly Role[];
  readOnly: boolean;
}

interface Change {
  label: string;
  calls: Call[];
  /** Tree row to show the saving / saved / failed state on. */
  rowId?: string;
}

type Pending =
  | { kind: "module_off"; node: TreeNode; key: Extract<Control, { t: "module" }>["key"] }
  | { kind: "preset"; title: string; patchOf: (role: Role) => ReturnType<typeof presetPatch>; roles: readonly Role[] };

const FILTERS: readonly { id: StatusFilter; label: string }[] = [{ id: "all", label: "All" }, { id: "on", label: "On" }, { id: "off", label: "Off" }, { id: "locked", label: "Locked" }];
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function ControlCentre({ slug, model, initialSettings, roles, readOnly }: Props) {
  const [settings, setSettings] = useState(initialSettings);
  const live = useRef(initialSettings);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [saves, setSaves] = useState<Record<string, RowSave>>({});
  const [area, setArea] = useState<"system" | "ai">("system");
  const [role, setRole] = useState<Role>(roles.includes("teacher") ? "teacher" : roles[0]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [pending, setPending] = useState<Pending | null>(null);
  const [presetTarget, setPresetTarget] = useState<"role" | "all">("role");

  const tree = useMemo(() => (area === "system" ? buildSystemTree(settings) : buildAiTree(model, settings, role)), [area, settings, model, role]);
  const shown = useMemo(() => filterTree(tree, query, status), [tree, query, status]);
  const filtering = query.trim() !== "" || status !== "all";
  const summary = useMemo(() => {
    const c = tree.reduce((a, n) => { const k = countOn(n); return { on: a.on + k.on, total: a.total + k.total }; }, { on: 0, total: 0 });
    return area === "system" ? `${c.on} of ${c.total} features on` : `${c.on} of ${c.total} tools and tasks on for ${roleName(role)}`;
  }, [tree, area, role]);

  const mark = (id: string | undefined, s: RowSave | null) => {
    if (!id) return;
    setSaves((p) => { const n = { ...p }; if (s) n[id] = s; else delete n[id]; return n; });
  };

  async function run(call: Call): Promise<string | null> {
    const r = call.t === "module" ? await setModuleEnabled(slug, { key: call.key, enabled: call.enabled })
      : call.t === "feature" ? await setFeatureEnabled(slug, { key: call.key, enabled: call.enabled })
      : await setAiRoleConfig(slug, { role: call.role, patch: call.patch });
    return r.ok ? null : r.error.message;
  }

  function submit(change: Change, offerUndo = true): void {
    // Optimistic: apply now, remember each call's inverse for revert and undo.
    const inverses: Call[] = [];
    let next = live.current;
    for (const c of change.calls) { inverses.push(inverseCall(model, next, c)); next = applyCall(next, c); }
    live.current = next;
    setSettings(next);
    mark(change.rowId, { state: "saving" });

    queue.current = queue.current.then(async () => {
      for (let i = 0; i < change.calls.length; i++) {
        const message = await run(change.calls[i]);
        if (message) {
          // Put back this call and the ones not yet sent; earlier calls did save.
          let back = live.current;
          for (let j = change.calls.length - 1; j >= i; j--) back = applyCall(back, inverses[j]);
          live.current = back;
          setSettings(back);
          mark(change.rowId, { state: "failed", message });
          toast.error(`${change.label} failed: ${message}`);
          return;
        }
      }
      mark(change.rowId, { state: "saved" });
      setTimeout(() => mark(change.rowId, null), 2500);
      if (offerUndo) {
        toast(change.label, { action: { label: "Undo", onClick: () => submit({ label: `Undid: ${change.label}`, calls: [...inverses].reverse(), rowId: change.rowId }, false) } });
      }
    });
  }

  function toggle(node: TreeNode): void {
    const control = node.control;
    if (!control || readOnly) return;
    const next = node.status !== "on";
    if (control.t === "module" && !next) {
      setPending({ kind: "module_off", node, key: control.key });
      return;
    }
    submit({ label: `${node.label} ${next ? "on" : "off"}`, calls: callsFor(live.current, role, control, next), rowId: node.id });
  }

  function fix(node: TreeNode): void {
    const f: Fix | undefined = node.fix;
    if (!f || readOnly) return;
    const calls: Call[] =
      f.kind === "module" ? callsFor(live.current, role, { t: "module", key: f.key }, true)
      : f.kind === "feature" ? callsFor(live.current, role, { t: "feature", key: f.key }, true)
      : f.kind === "role" ? [{ t: "role", role, patch: { enabled: true } }]
      : f.kind === "mode" ? callsFor(live.current, role, { t: "mode", mode: f.mode }, true)
      : callsFor(live.current, role, { t: "group", group: f.group }, true);
    submit({ label: fixLabel(f), calls, rowId: node.id });
  }

  function confirmPending(): void {
    const p = pending;
    setPending(null);
    if (!p) return;
    if (p.kind === "module_off") {
      const impact = moduleOffImpact(model, live.current, p.key, roles);
      submit({ label: `${p.node.label} off`, calls: impact.order.map((key) => ({ t: "module", key, enabled: false })), rowId: p.node.id });
    } else {
      submit({ label: p.title, calls: p.roles.map((r) => ({ t: "role", role: r, patch: p.patchOf(r) })) });
    }
  }

  const presetRoles = presetTarget === "all" ? roles : [role];
  const startPreset = (title: string, patchOf: (r: Role) => ReturnType<typeof presetPatch>) => setPending({ kind: "preset", title, patchOf, roles: presetRoles });

  return (
    <div className="space-y-4">
      {readOnly && <p className="rounded-md border border-border bg-muted/40 p-3 text-sm">You can view these settings but not change them.</p>}

      <div role="tablist" aria-label="Area" className="inline-flex rounded-lg border border-border p-1">
        {(["system", "ai"] as const).map((a) => (
          <button key={a} type="button" role="tab" aria-selected={area === a} onClick={() => setArea(a)}
            className={cn("min-h-10 rounded-md px-4 text-sm font-medium", area === a ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
            {a === "system" ? "System" : "AI orb"}
          </button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        {area === "system" ? "Modules, and the features inside each module. Turning a module off also turns off what needs it." : "Per role: modes, then groups, then the AI tools and tasks. These settings only narrow what a role's permissions and the school's modules already allow."}
      </p>

      {area === "ai" && (
        <div role="radiogroup" aria-label="Role" className="flex flex-wrap gap-2">
          {roles.map((r) => (
            <button key={r} type="button" role="radio" aria-checked={role === r} onClick={() => setRole(r)}
              className={cn("min-h-10 rounded-full border px-3 text-sm", role === r ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}>
              {cap(roleName(r))}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search modules, features, tools, tasks or action names" aria-label="Search settings" className="pl-9" />
        </div>
        <div role="group" aria-label="Show" className="flex gap-1">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={status === f.id} onClick={() => setStatus(f.id)}
              className={cn("min-h-10 rounded-md border px-3 text-sm", status === f.id ? "border-primary bg-primary/10 font-medium" : "border-border hover:bg-muted")}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {area === "ai" && !readOnly && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
          <span className="text-sm font-medium">Presets</span>
          <div role="group" aria-label="Apply to" className="flex gap-1">
            {(["role", "all"] as const).map((t) => (
              <button key={t} type="button" aria-pressed={presetTarget === t} onClick={() => setPresetTarget(t)}
                className={cn("min-h-9 rounded-md border px-2.5 text-xs", presetTarget === t ? "border-primary bg-primary/10 font-medium" : "border-border")}>
                {t === "role" ? `Only ${roleName(role)}` : "All roles"}
              </button>
            ))}
          </div>
          {PRESETS.map((p: Preset) => (
            <Button key={p.id} type="button" variant="outline" size="sm" title={p.description} onClick={() => startPreset(`Preset: ${p.label}`, (r) => presetPatch(p, r, live.current))}>{p.label}</Button>
          ))}
          <Button type="button" variant="ghost" size="sm" onClick={() => startPreset("Reset to defaults", (r) => resetPatch(model, r, live.current))}>Reset to defaults</Button>
          {!roleChatOn(model, settings, role) && <span className="w-full text-xs text-muted-foreground">AI is off for {roleName(role)}: every chat tool and task below is off until you turn it on.</span>}
        </div>
      )}

      <div className="flex items-center justify-between text-sm">
        <h2 className="font-semibold">{area === "system" ? "System" : `AI orb: ${cap(roleName(role))}`}</h2>
        <span className="text-muted-foreground" aria-live="polite">{summary}</span>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nothing matches. Clear the search or the filter.</p>
      ) : (
        <TreeView key={`${area}:${area === "ai" ? role : ""}`} nodes={shown} label={area === "system" ? "Modules and features" : `AI orb for ${roleName(role)}`} forceOpen={filtering} readOnly={readOnly} saves={saves} onToggle={toggle} onFix={fix} />
      )}

      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          {pending?.kind === "module_off" && <ModuleOffBody model={model} settings={settings} roles={roles} moduleKey={pending.key} label={pending.node.label} />}
          {pending?.kind === "preset" && <PresetBody model={model} settings={settings} p={pending} />}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPending(null)}>Cancel</Button>
            <Button type="button" onClick={confirmPending}>{pending?.kind === "module_off" ? "Turn off" : "Apply"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function List({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-sm font-medium">{title} ({items.length})</p>
      <p className="text-sm text-muted-foreground">{items.slice(0, 12).join(", ")}{items.length > 12 ? `, and ${items.length - 12} more` : ""}</p>
    </div>
  );
}

function ModuleOffBody({ model, settings, roles, moduleKey, label }: { model: CcModel; settings: CcSettings; roles: readonly Role[]; moduleKey: Parameters<typeof moduleOffImpact>[2]; label: string }) {
  const i = moduleOffImpact(model, settings, moduleKey, roles);
  const names = i.dependents.map((k) => buildSystemTree(settings).flatMap((c) => c.children).find((n) => n.id === `module:${k}`)?.label ?? k);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Turn off {label}?</DialogTitle>
        <DialogDescription>This also turns off everything below. Saved AI settings for these are kept and apply again when the module is back on.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <List title="Other modules that need it" items={names} />
        <List title="Features" items={i.features} />
        <List title="AI tools" items={i.capabilities} />
        <List title="AI tasks" items={i.tasks} />
        {names.length + i.features.length + i.capabilities.length + i.tasks.length === 0 && <p className="text-sm text-muted-foreground">Nothing else depends on it.</p>}
      </div>
    </>
  );
}

function PresetBody({ model, settings, p }: { model: CcModel; settings: CcSettings; p: Extract<Pending, { kind: "preset" }> }) {
  const preview = previewPatch(model, settings, p.roles, p.patchOf);
  const changed = preview.filter((x) => x.lines.length > 0);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{p.title}</DialogTitle>
        <DialogDescription>{p.roles.length === 1 ? `For ${roleName(p.roles[0])}.` : `For ${p.roles.length} roles.`} Preview of the changes:</DialogDescription>
      </DialogHeader>
      <div className="max-h-72 space-y-2 overflow-auto">
        {changed.length === 0 && <p className="text-sm text-muted-foreground">No change: the settings already match.</p>}
        {changed.map((x) => (
          <div key={x.role}>
            <p className="text-sm font-medium">{cap(roleName(x.role))}</p>
            <ul className="list-disc pl-5 text-sm text-muted-foreground">{x.lines.map((l) => <li key={l}>{l}</li>)}</ul>
          </div>
        ))}
      </div>
    </>
  );
}
