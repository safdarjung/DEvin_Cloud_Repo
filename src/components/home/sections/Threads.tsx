"use client";

import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { HONESTY_TEXT, PROBLEMS, THREAD, type ThreadKey } from "../story";
import { THREAD_MODULES } from "../threads";
import type { ModulePatch } from "./Modules";

const INK = "#1f2937";
const CELL = 40;
const PAD = 26;
const BAND = 22;
const LANES = PROBLEMS.length;
const SIZE = PAD * 2 + LANES * CELL;
const at = (i: number) => PAD + i * CELL + CELL / 2;

/**
 * The visitor's own cloth: the warp is always strung; each loose thread they pick is woven across it in its
 * colour, and the ones they have not picked hang as a dashed line. Same geometry as WeaveArt.
 */
function Loom({ picked }: { picked: ReadonlySet<ThreadKey> }) {
  return (
    <svg className="lh-loom" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
      {PROBLEMS.map((p, r) =>
        picked.has(p.thread) ? <rect key={p.thread} className="lh-loom-weft" x={6} y={at(r) - BAND / 2} width={SIZE - 12} height={BAND} rx={BAND / 2} fill={THREAD[p.thread].color} stroke={INK} strokeWidth={3} /> : null,
      )}
      {PROBLEMS.map((_, c) => (
        <rect key={c} x={at(c) - BAND / 2} y={6} width={BAND} height={SIZE - 12} rx={BAND / 2} className="lh-loom-warp" stroke={INK} strokeWidth={3} />
      ))}
      {PROBLEMS.map((p, r) =>
        picked.has(p.thread) ? null : <path key={p.thread} className="lh-loom-loose" d={`M${PAD} ${at(r)}q${CELL / 2} -10 ${CELL} 0${`t${CELL} 0`.repeat(LANES - 1)}`} />,
      )}
      {PROBLEMS.map((p, r) =>
        picked.has(p.thread)
          ? PROBLEMS.map((_, c) =>
              (r + c) % 2 === 0 ? null : (
                <g key={`${p.thread}-${c}`} className="lh-loom-over">
                  <rect x={at(c) - CELL / 2 + 3} y={at(r) - BAND / 2} width={CELL - 6} height={BAND} fill={THREAD[p.thread].color} />
                  <path d={`M${at(c) - CELL / 2 + 3} ${at(r) - BAND / 2}h${CELL - 6}M${at(c) - CELL / 2 + 3} ${at(r) + BAND / 2}h${CELL - 6}`} stroke={INK} strokeWidth={3} />
                </g>
              ),
            )
          : null,
      )}
    </svg>
  );
}

/**
 * "Where do we start?", answered by the visitor: tick what the school still runs on, and the page weaves
 * those threads and lists the modules that replace them. The choice travels to the contact form.
 */
export function Threads({ modules }: { modules: readonly ModulePatch[] }) {
  const [picked, setPicked] = useState<ReadonlySet<ThreadKey>>(new Set());
  const toggle = (key: ThreadKey) =>
    setPicked((old) => {
      const next = new Set(old);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const chosen = PROBLEMS.filter((p) => picked.has(p.thread));
  const byKey = new Map(modules.map((m) => [m.key, m]));
  const href = chosen.length ? `/contact?threads=${chosen.map((p) => p.thread).join(",")}` : "/contact";

  return (
    <section id="threads" className="lh-section" aria-labelledby="threads-title">
      <header className="lh-head" data-reveal="">
        <p className="lm-eyebrow">Where to begin</p>
        <h2 id="threads-title" className="lm-display lh-h2">
          Which loose threads does your school run on?
        </h2>
        <p className="lm-lead">Tick what you still use today. Each one is woven in, with the modules that replace it.</p>
      </header>

      <div className="lh-threads">
        <ul className="lh-thread-list" aria-label="What the school runs on today">
          {PROBLEMS.map((p, i) => {
            const on = picked.has(p.thread);
            return (
              <li key={p.thread} data-reveal="left" style={{ "--i": i, "--thread": THREAD[p.thread].color } as CSSProperties}>
                <button type="button" className="lh-thread lm-focus" aria-pressed={on} onClick={() => toggle(p.thread)}>
                  <span className="lh-thread-box" aria-hidden="true">
                    {on && <Check className="size-4" strokeWidth={3.5} />}
                  </span>
                  <span>
                    <strong>{p.artefact}</strong>
                    <span className="lh-thread-pain">{p.pain}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="lh-thread-out lm-card" data-reveal="right">
          <Loom picked={picked} />
          <div className="lh-thread-result" aria-live="polite">
            {chosen.length === 0 ? (
              <p className="lh-thread-empty">
                <strong>Nothing woven yet.</strong> Tick a loose thread and it crosses the loom.
              </p>
            ) : (
              <>
                <p className="lh-thread-count">
                  <strong>
                    {chosen.length} of {PROBLEMS.length} threads woven.
                  </strong>{" "}
                  Switch these on first:
                </p>
                <ul className="lh-thread-mods">
                  {chosen.map((p) => (
                    <li key={p.thread} style={{ "--thread": THREAD[p.thread].color } as CSSProperties}>
                      <span className="lh-thread-domain">
                        <span className="lh-tab-bead" aria-hidden="true" />
                        {THREAD[p.thread].label}
                      </span>
                      {THREAD_MODULES[p.thread].map((key) => {
                        const m = byKey.get(key);
                        return m ? (
                          <span key={key} className="lh-thread-mod">
                            <span className="lm-chip">{m.label}</span>
                            {m.honesty && <span className="lm-honest">{HONESTY_TEXT[m.honesty]}</span>}
                          </span>
                        ) : null;
                      })}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <Link href={href} className="lm-btn" data-kind={chosen.length ? undefined : "paper"}>
              {chosen.length ? `Book a demo for ${chosen.length === 1 ? "this thread" : `these ${chosen.length} threads`}` : "Book a demo"} <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
