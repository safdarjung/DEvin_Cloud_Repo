const MIN_WORDS = 3;
const MAX_Q = 500; // mirrors parseOrbQuery's cap

const ASK = "Tell me more about this: ";

/**
 * The question the orb is asked about a text selection, or null when it is under 3 words. The caller hands
 * it over in sessionStorage (ORB_ASK_KEY), not in the URL: selected text can hold personal details.
 */
export function selectionQuestion(selected: string): string | null {
  const text = selected.replace(/\s+/g, " ").trim();
  if (text.split(" ").filter(Boolean).length < MIN_WORDS) return null;
  return `${ASK}"${text.slice(0, MAX_Q - ASK.length - 2)}"`;
}

export type ShortcutAction = "orb" | "help";

/** Ctrl/Cmd+J opens the orb anywhere; a bare "?" opens the shortcuts sheet outside fields. */
export function matchShortcut(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }, inField: boolean): ShortcutAction | null {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "j") return "orb";
  if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey && !inField) return "help";
  return null;
}

export function isEditableTarget(t: Element | null): boolean {
  if (!t) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || (t as HTMLElement).isContentEditable === true;
}

/** True when following `href` from `from` changes the in-app path (query-only and hash links do not). */
export function isInternalNav(href: string, from: string): boolean {
  try {
    const a = new URL(href, from);
    const b = new URL(from);
    return a.origin === b.origin && a.pathname !== b.pathname;
  } catch {
    return false;
  }
}

/** Only shortcuts that exist in the app: command palette, orb launcher, orb page keys. */
export const SHORTCUTS: readonly { keys: string; label: string }[] = [
  { keys: "Ctrl/⌘ K", label: "Search and quick actions" },
  { keys: "Ctrl/⌘ J", label: "Open the AI orb" },
  { keys: "?", label: "Show this list" },
  { keys: "1 – 6", label: "Switch mode (on the orb page)" },
  { keys: "/", label: "Jump to the message box (on the orb page)" },
  { keys: "S", label: "Surprise me: show a random thing the orb can do (on the orb page)" },
  { keys: "Esc", label: "Close a sheet or panel" },
];
