"use client";

// Dialog to show/hide and reorder the home-dashboard widgets this user already
// has. UX only: the page ignores ids the user is not entitled to, and the
// actions re-check `dashboard.view`.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { ActionResult } from "@/lib/actions/result";
import { describeActionError } from "@/lib/action-error";
import { resetDashboardLayout, saveDashboardLayout } from "@/modules/core/dashboard-layout.actions";
import type { DashboardWidgetId } from "@/modules/core/dashboard-widgets";

type Item = { id: DashboardWidgetId; label: string; visible: boolean };

export function CustomiseDashboard({ institutionSlug, widgets, customised }: { institutionSlug: string; widgets: Item[]; customised: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>(widgets);
  const [pending, start] = useTransition();

  const move = (from: number, to: number) =>
    setItems((cur) => {
      if (to < 0 || to >= cur.length) return cur;
      const next = [...cur];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
  const toggle = (id: string) => setItems((cur) => cur.map((i) => (i.id === id ? { ...i, visible: !i.visible } : i)));

  const run = (call: () => Promise<ActionResult<unknown>>, done: string) =>
    start(async () => {
      const result = await call();
      if (!result.ok) {
        toast.error(describeActionError(result.error));
        return;
      }
      toast.success(done);
      setOpen(false);
      router.refresh();
    });

  const save = () =>
    run(
      () => saveDashboardLayout(institutionSlug, { hidden: items.filter((i) => !i.visible).map((i) => i.id), order: items.map((i) => i.id) }),
      "Dashboard saved.",
    );
  const reset = () => run(() => resetDashboardLayout(institutionSlug, {}), "Dashboard reset to default.");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setItems(widgets);
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="min-h-10 bg-background/70 backdrop-blur-sm">
          <SlidersHorizontal className="size-4" aria-hidden />
          Customise
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] max-w-[calc(100%-1rem)] flex-col gap-3 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Customise your dashboard</DialogTitle>
          <DialogDescription>Show or hide sections and change their order. Only you see this layout.</DialogDescription>
        </DialogHeader>
        <ul className="-mx-1 min-h-0 flex-1 space-y-1 overflow-y-auto px-1">
          {items.map((item, i) => (
            <li key={item.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  role="switch"
                  checked={item.visible}
                  onChange={() => toggle(item.id)}
                  className="size-4 shrink-0 accent-[var(--primary)]"
                />
                <span className="min-w-0 truncate">{item.label}</span>
              </label>
              <Button type="button" variant="ghost" size="icon" className="size-8" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label={`Move ${item.label} up`}>
                <ArrowUp className="size-4" aria-hidden />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="size-8" disabled={i === items.length - 1} onClick={() => move(i, i + 1)} aria-label={`Move ${item.label} down`}>
                <ArrowDown className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="ghost" onClick={reset} disabled={pending || !customised}>
            Reset to default
          </Button>
          <Button type="button" onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
