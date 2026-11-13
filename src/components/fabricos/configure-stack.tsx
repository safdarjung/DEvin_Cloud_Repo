"use client";

import { useState } from "react";
import { cn } from "cn";
import { CONFIGURE_LAYERS } from "./content";

/**
 * Five configuration layers as a stacked, tilted pile. Choosing a layer in the
 * list lifts its slab out of the stack and shows its description.
 */
export function ConfigureStack() {
  const [active, setActive] = useState(0);
  const n = CONFIGURE_LAYERS.length;

  return (
    <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-20">
      <ul className="divide-y divide-(color:--fos-line) border-y border-(color:--fos-line)">
        {CONFIGURE_LAYERS.map((l, i) => {
          const on = i === active;
          return (
            <li key={l.title}>
              <h3>
                <button
                  type="button"
                  aria-expanded={on}
                  aria-controls={`fos-layer-${i}`}
                  onClick={() => setActive(i)}
                  className={cn(
                    "group flex min-h-11 w-full items-center gap-4 pt-5 text-left text-xl font-medium tracking-[-0.02em] transition-colors",
                    on ? "text-(color:--fos-fg)" : "pb-5 text-(color:--fos-muted) hover:text-(color:--fos-fg)",
                  )}
                >
                  <span aria-hidden className={cn("h-px shrink-0 transition-all duration-300", on ? "w-10 bg-(color:--fos-cyan)" : "w-6 bg-(color:--fos-line-strong)")} />
                  {l.title}
                </button>
              </h3>
              <div
                id={`fos-layer-${i}`}
                aria-hidden={!on}
                className={cn("grid pl-14 transition-[grid-template-rows,opacity] duration-500 ease-(--fos-ease)", on ? "grid-rows-[1fr] pb-5 opacity-100" : "grid-rows-[0fr] opacity-0")}
              >
                <p className="overflow-hidden pt-2 leading-relaxed text-(color:--fos-muted)">{l.body}</p>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Visual stack, decorative: the list is the accessible control. */}
      <div aria-hidden className="relative mx-auto h-[300px] w-full max-w-[460px] [perspective:1400px] sm:h-[380px]">
        {CONFIGURE_LAYERS.map((l, i) => {
          const on = i === active;
          const depth = n - 1 - i; // top slab = first layer
          return (
            <div
              key={l.title}
              className="fos-slab absolute inset-x-0 mx-auto h-[150px] w-[82%] transition-[transform,border-color,background-color] duration-500 ease-(--fos-ease) sm:h-[180px]"
              style={{
                top: `${depth * 13}%`,
                zIndex: i === active ? 20 : n - depth,
                transform: `rotateX(58deg) rotateZ(-38deg) translateZ(${on ? 46 : 0}px)`,
              }}
            >
              <div
                className={cn(
                  "flex h-full w-full items-end rounded-2xl border p-4 transition-colors duration-300",
                  on
                    ? "border-(color:--fos-cyan) bg-[linear-gradient(140deg,rgb(103_215_234_/_0.22),rgb(75_82_200_/_0.28))] shadow-[0_30px_60px_-20px_rgb(103_215_234_/_0.35)]"
                    : "border-(color:--fos-line-strong) bg-(color:--fos-elev)/90",
                )}
              >
                <span className={cn("text-xs font-medium", on ? "text-(color:--fos-fg)" : "text-(color:--fos-faint)")}>{l.title}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
