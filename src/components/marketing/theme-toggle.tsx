"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

/** Both icons render; CSS picks one, so there is no hydration mismatch. */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="inline-flex size-11 items-center justify-center rounded-md text-(color:--mk-muted) transition-colors hover:bg-(color:--mk-surface) hover:text-(color:--mk-fg) focus-visible:outline-2 focus-visible:outline-(color:--mk-accent)"
    >
      <Sun className="size-[18px] dark:hidden" aria-hidden />
      <Moon className="hidden size-[18px] dark:block" aria-hidden />
      <span className="sr-only">Toggle colour theme</span>
    </button>
  );
}
