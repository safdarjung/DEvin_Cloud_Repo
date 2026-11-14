"use client";

import { useState, type CSSProperties } from "react";
import { Search } from "lucide-react";
import { cn } from "cn";
import type { ModulePatch } from "@/components/home/sections/Modules";
import { HONESTY_TEXT } from "@/components/home/story";
import { ScrollReveal } from "./scroll-reveal";
import { SectionShell } from "./section-shell";

const id = "modules";
const HUES = ["attendance", "fees", "exams", "admissions", "parents", "learning", "office"] as const;

/** Every module as one switchboard: search or filter, point at a module to read what it does. */
export function ModulesSection({ modules }: { modules: readonly ModulePatch[] }) {
  const categories = [...new Set(modules.map((m) => m.category))];
  const hue = (category: string) => ({ "--hue": `var(--th-${HUES[categories.indexOf(category) % HUES.length]})` }) as CSSProperties;
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(modules[0].key);
  const [hovered, setHovered] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const shown = modules.filter((m) => (!category || m.category === category) && (!q || `${m.label} ${m.description} ${m.category}`.toLowerCase().includes(q)));
  const detail = modules.find((m) => m.key === (hovered ?? picked)) ?? modules[0];
  const core = modules.filter((m) => m.core).length;
  const filter = "min-h-9 rounded-full border px-3.5 text-sm whitespace-nowrap transition-colors";

  return (
    <SectionShell id={id} className="bg-(color:--fos-bg-2) !pt-0">
      <ScrollReveal>
        <div className="flex flex-col gap-8 border-t border-(color:--fos-line) pt-16 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <h2 id={`${id}-title`} className="text-3xl leading-[1.08] font-medium tracking-[-0.03em] text-(color:--fos-fg) md:text-[2.5rem]" data-reveal>
              {modules.length} modules. Switch on what you need.
            </h2>
            <p className="fos-lead mt-4" data-reveal>
              {core} core modules are always on. The other {modules.length - core} are switches in settings, so a small institution starts small.
            </p>
          </div>
          <label className="relative block w-full lg:w-80" data-reveal>
            <span className="sr-only">Find a module</span>
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-(color:--fos-faint)" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a module, e.g. transport, payroll"
              className="h-12 w-full rounded-full border border-(color:--fos-line-strong) bg-(color:--fos-surface) pr-4 pl-11 text-(color:--fos-fg) placeholder:text-(color:--fos-faint)"
            />
          </label>
        </div>

        <div className="mt-8 flex gap-2 overflow-x-auto pb-2" role="group" aria-label="Filter by category" data-reveal>
          <button type="button" aria-pressed={category === null} onClick={() => setCategory(null)} className={cn(filter, category === null ? "border-transparent bg-(color:--fos-fg) text-(color:--fos-accent-fg)" : "border-(color:--fos-line-strong) text-(color:--fos-muted) hover:text-(color:--fos-fg)")}>
            All {modules.length}
          </button>
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={category === c}
              onClick={() => setCategory(category === c ? null : c)}
              style={hue(c)}
              className={cn(filter, "inline-flex items-center gap-2", category === c ? "border-(color:--hue) bg-[color-mix(in_oklab,var(--hue)_16%,transparent)] text-(color:--fos-fg)" : "border-(color:--fos-line-strong) text-(color:--fos-muted) hover:text-(color:--fos-fg)")}
            >
              <span aria-hidden className="size-1.5 rounded-full bg-(color:--hue)" />
              {c} {modules.filter((m) => m.category === c).length}
            </button>
          ))}
        </div>

        <div className="fos-panel mt-4 flex min-h-24 flex-col justify-center gap-1.5 px-6 py-5 sm:px-8" style={hue(detail.category)} aria-live="polite" data-reveal>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-lg font-medium tracking-[-0.01em] text-(color:--fos-fg)">
            {detail.label}
            <span className="font-(family-name:--fos-font-mono) text-xs font-normal tracking-[0.06em] text-(color:--hue) uppercase">{detail.category}</span>
            {detail.core ? <span className="rounded-full border border-(color:--fos-line-strong) px-2 py-0.5 text-xs font-normal text-(color:--fos-muted)">Always on</span> : null}
            {detail.honesty ? <span className="fos-honest font-normal">{HONESTY_TEXT[detail.honesty]}</span> : null}
          </p>
          <p className="leading-relaxed text-(color:--fos-muted)">{detail.description}</p>
        </div>

        <ul className="mt-4 flex flex-wrap gap-2" onPointerLeave={() => setHovered(null)}>
          {shown.map((m) => (
            <li key={m.key}>
              <button
                type="button"
                aria-pressed={m.key === picked}
                onClick={() => setPicked(m.key)}
                onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(m.key)}
                onFocus={() => setHovered(m.key)}
                onBlur={() => setHovered(null)}
                style={hue(m.category)}
                className={cn(
                  "inline-flex min-h-10 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors duration-200",
                  m.key === detail.key ? "border-(color:--hue) bg-[color-mix(in_oklab,var(--hue)_14%,transparent)] text-(color:--fos-fg)" : "border-(color:--fos-line) text-(color:--fos-muted) hover:text-(color:--fos-fg)",
                )}
              >
                <span aria-hidden className="size-1.5 rounded-full bg-(color:--hue)" />
                {m.label}
                {m.honesty ? <span aria-hidden className="size-1.5 rounded-full bg-(color:--fos-warn)" title={HONESTY_TEXT[m.honesty]} /> : null}
              </button>
            </li>
          ))}
        </ul>
        {shown.length === 0 ? <p className="mt-6 text-(color:--fos-muted)">No module matches “{query}”.</p> : null}
        <p className="fos-tag mt-6">An amber dot marks a module that is simulated, limited or in test mode. Its description says which.</p>
      </ScrollReveal>
    </SectionShell>
  );
}
