"use client";

// Accessible tree (WAI-ARIA tree pattern): arrows move, Right/Left open and close,
// Space flips the row's switch, Enter runs the row's "Turn on ..." fix (else opens/closes).
// State is always text + icon, never colour alone.
import { Check, ChevronRight, Loader2, Lock, Minus, TriangleAlert } from "lucide-react";
import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "cn";
import { countOn, fixLabel, type TreeNode } from "@/modules/core/control-centre/state";

export type RowSave = { state: "saving" | "saved" | "failed"; message?: string };

interface Props {
  nodes: readonly TreeNode[];
  label: string;
  /** Search or filter active: every branch is shown open. */
  forceOpen: boolean;
  readOnly: boolean;
  saves: Readonly<Record<string, RowSave>>;
  onToggle: (node: TreeNode) => void;
  onFix: (node: TreeNode) => void;
}

const STATUS = {
  on: { text: "On", Icon: Check },
  off: { text: "Off", Icon: Minus },
  locked: { text: "Locked", Icon: Lock },
} as const;

export function TreeView({ nodes, label, forceOpen, readOnly, saves, onToggle, onFix }: Props) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(nodes.map((n) => n.id)));
  const [focusId, setFocusId] = useState<string | null>(nodes[0]?.id ?? null);
  const root = useRef<HTMLUListElement>(null);

  const flip = useCallback((id: string) => setOpen((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  const items = () => Array.from(root.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []).filter((el) => !el.parentElement?.closest('[role="group"][hidden]'));
  const focusEl = (el: HTMLElement | undefined) => { if (el) { setFocusId(el.dataset.id ?? null); el.focus(); } };

  function onKey(e: KeyboardEvent<HTMLLIElement>, node: TreeNode, isOpen: boolean) {
    if (e.target !== e.currentTarget) return;
    const list = items();
    const i = list.indexOf(e.currentTarget);
    const has = node.children.length > 0;
    const act = (fn: () => void) => { e.preventDefault(); fn(); };
    switch (e.key) {
      case "ArrowDown": return act(() => focusEl(list[i + 1]));
      case "ArrowUp": return act(() => focusEl(list[i - 1]));
      case "Home": return act(() => focusEl(list[0]));
      case "End": return act(() => focusEl(list.at(-1)));
      case "ArrowRight": return act(() => { if (has && !isOpen) flip(node.id); else if (has) focusEl(list[i + 1]); });
      case "ArrowLeft": return act(() => { if (has && isOpen && !forceOpen) flip(node.id); else focusEl(e.currentTarget.parentElement?.closest<HTMLElement>('[role="treeitem"]') ?? undefined); });
      case " ": return act(() => { if (node.control && !node.fix && !readOnly) onToggle(node); else if (node.control && node.kind === "module" && !readOnly) onToggle(node); });
      case "Enter": return act(() => { if (node.fix && !readOnly) onFix(node); else if (has) flip(node.id); else if (node.control && !readOnly) onToggle(node); });
    }
  }

  const render = (node: TreeNode, level: number): React.ReactNode => {
    const has = node.children.length > 0;
    const isOpen = has && (forceOpen || open.has(node.id));
    const { text, Icon } = STATUS[node.status];
    const save = saves[node.id];
    const c = countOn(node);
    const switchable = node.control !== undefined && !readOnly && (!node.fix || node.kind === "module");
    return (
      <li
        key={node.id} role="treeitem" aria-level={level} aria-expanded={has ? isOpen : undefined} aria-selected={false}
        data-id={node.id} tabIndex={focusId === node.id ? 0 : -1} onFocus={(e) => { if (e.target === e.currentTarget) setFocusId(node.id); }}
        onKeyDown={(e) => onKey(e, node, isOpen)} className="group/item list-none outline-none"
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2 py-1.5 group-focus-visible/item:ring-2 group-focus-visible/item:ring-ring hover:bg-muted/50" style={{ paddingLeft: `${(level - 1) * 14 + 8}px` }}>
          <button type="button" tabIndex={-1} aria-hidden={!has} onClick={() => has && !forceOpen && flip(node.id)} className={cn("flex size-6 shrink-0 items-center justify-center rounded", !has && "invisible")}>
            <ChevronRight className={cn("size-4 transition-transform", isOpen && "rotate-90")} aria-hidden />
          </button>
          <div className="min-w-0 flex-1 basis-40">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className={cn("text-sm", node.kind === "category" || node.kind === "mode" ? "font-semibold" : "font-medium")}>{node.label}</span>
              {has && node.kind !== "blocked" && c.total > 0 && <span className="text-xs text-muted-foreground">{c.on} of {c.total} on</span>}
              {has && node.kind === "blocked" && <span className="text-xs text-muted-foreground">{countAll(node)} actions</span>}
            </div>
            {node.hint && node.kind !== "mode" && <p className="line-clamp-1 text-xs text-muted-foreground">{node.hint}</p>}
            {node.reason && node.kind !== "category" && (
              <p className="text-xs text-muted-foreground">
                {node.reason}
                {node.fix && !readOnly && (
                  <button type="button" tabIndex={-1} onClick={() => onFix(node)} className="ml-1 font-medium text-foreground underline underline-offset-2 hover:no-underline">
                    {fixLabel(node.fix)}
                  </button>
                )}
              </p>
            )}
          </div>
          {node.kind !== "category" && node.kind !== "blocked" && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" aria-hidden>
              <Icon className="size-3.5" />{node.control || node.status !== "on" ? text : "Always on"}
            </span>
          )}
          {save && (
            <span role="status" className={cn("inline-flex items-center gap-1 text-xs", save.state === "failed" ? "text-destructive" : "text-muted-foreground")}>
              {save.state === "saving" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : save.state === "failed" ? <TriangleAlert className="size-3.5" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
              {save.state === "saving" ? "Saving" : save.state === "saved" ? "Saved" : `Failed${save.message ? `: ${save.message}` : ""}`}
            </span>
          )}
          {node.control && node.kind !== "blocked" && (
            <button
              type="button" role="switch" aria-checked={node.status === "on"} aria-label={node.label} aria-disabled={!switchable} tabIndex={-1}
              onClick={() => switchable && onToggle(node)}
              className={cn("relative h-6 w-11 shrink-0 rounded-full border transition-colors", node.status === "on" ? "border-primary bg-primary" : "border-border bg-muted", !switchable && "opacity-50")}
            >
              <span className={cn("absolute top-0.5 left-0.5 size-4.5 rounded-full bg-background shadow transition-transform", node.status === "on" && "translate-x-5")} />
            </button>
          )}
        </div>
        {has && (
          <ul role="group" hidden={!isOpen} className="m-0 p-0">
            {isOpen && node.children.map((ch) => render(ch, level + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <ul ref={root} role="tree" aria-label={label} className="m-0 divide-y-0 p-0">
      {nodes.map((n) => render(n, 1))}
    </ul>
  );
}

function countAll(n: TreeNode): number {
  return n.children.length === 0 ? 1 : n.children.reduce((a, c) => a + countAll(c), 0);
}
