import type { KeyboardEvent } from "react";

/**
 * Keyboard model for a `role="tablist"`: Left/Right (wrapping), Home and End move to another tab, select it
 * and focus it. Pair with a roving tabindex (`tabIndex={i === active ? 0 : -1}`) on the tabs.
 */
export function tabKeyDown(e: KeyboardEvent<HTMLElement>, count: number, active: number, onPick: (index: number) => void): void {
  const next =
    e.key === "ArrowRight" ? (active + 1) % count : e.key === "ArrowLeft" ? (active - 1 + count) % count : e.key === "Home" ? 0 : e.key === "End" ? count - 1 : -1;
  if (next < 0) return;
  e.preventDefault();
  onPick(next);
  e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
}
