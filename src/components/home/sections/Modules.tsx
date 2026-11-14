"use client";

import { Search } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { HONESTY_TEXT, type HonestyLabel } from "../story";

export interface ModulePatch {
  key: string;
  label: string;
  category: string;
  description: string;
  core: boolean;
  honesty?: HonestyLabel;
}

/** One yarn colour per module category, cycling through the seven thread colours. */
const YARN = ["#00C853", "#FF6B35", "#7B61FF", "#00B8D9", "#FF2D95", "#2979FF", "#FFB800"];

/**
 * Every module as a patch in one quilt. Filter by category; pick a patch to read what it does. Everything
 * is rendered as text up front (the description sits inside each patch), so it works without the filter.
 */
export function Modules({ modules }: { modules: readonly ModulePatch[] }) {
  const categories = [...new Set(modules.map((m) => m.category))];
  const color = (category: string) => YARN[categories.indexOf(category) % YARN.length];
  const [category, setCategory] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  /** Phones show the first few patches until asked for the rest (CSS applies the cut below 640px only). */
  const [all, setAll] = useState(false);
  const [query, setQuery] = useState("");
  const core = modules.filter((m) => m.core).length;
  const needle = query.trim().toLowerCase();
  const matches = (m: ModulePatch) => !needle || `${m.label} ${m.category} ${m.description}`.toLowerCase().includes(needle);
  const found = needle ? modules.filter(matches).length : modules.length;

  return (
    <section id="modules" className="lh-section" aria-labelledby="modules-title">
      <header className="lh-head" data-reveal="">
        <p className="lm-eyebrow">Everything in the box</p>
        <h2 id="modules-title" className="lm-display lh-h2">
          {modules.length} modules. Switch on what you need.
        </h2>
        <p className="lm-lead">
          {core} core modules are always on. The other {modules.length - core} are switches in settings, so a small school starts small and a module you do not use is not in
          anyone&apos;s way.
        </p>
      </header>

      <label className="lh-search">
        <Search aria-hidden className="size-5" />
        <span className="sr-only">Find a module</span>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a module, e.g. transport, payroll, library" />
      </label>

      <div className="lh-orb-filters" role="group" aria-label="Filter modules by category">
        <button type="button" className="lh-filter lm-focus" aria-pressed={category === null} onClick={() => setCategory(null)}>
          All {modules.length}
        </button>
        {categories.map((c) => (
          <button key={c} type="button" className="lh-filter lm-focus" aria-pressed={category === c} style={{ "--thread": color(c) } as CSSProperties} onClick={() => setCategory(category === c ? null : c)}>
            <span className="lh-tab-bead" aria-hidden="true" />
            {c} {modules.filter((m) => m.category === c).length}
          </button>
        ))}
      </div>

      <ul className="lh-quilt" data-collapsed={!all && category === null && !needle ? "true" : undefined}>
        {modules.map((m, i) => {
          const dim = category !== null && m.category !== category;
          const isOpen = open === m.key;
          return (
            <li key={m.key} data-reveal="pop" data-dim={dim || undefined} data-hide={!matches(m) || undefined} data-open={isOpen || undefined} style={{ "--thread": color(m.category), "--i": i % 6 } as CSSProperties}>
              <button type="button" className="lh-patch lm-focus" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : m.key)}>
                <span className="lh-patch-cat">{m.category}</span>
                <span className="lh-patch-label">{m.label}</span>
                <span className="lh-patch-tags">
                  {m.core && <span className="lm-chip">Always on</span>}
                  {m.honesty && <span className="lm-honest">{HONESTY_TEXT[m.honesty]}</span>}
                </span>
                <span className="lh-patch-text">{m.description}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="lh-none" role="status" hidden={found > 0}>
        No module matches &ldquo;{query.trim()}&rdquo;. Ask us about it when you book a demo.
      </p>
      {!all && category === null && !needle && (
        <button type="button" className="lm-btn lh-more" data-kind="paper" onClick={() => setAll(true)}>
          Show all {modules.length} modules
        </button>
      )}
    </section>
  );
}
