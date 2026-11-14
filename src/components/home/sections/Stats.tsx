import type { CSSProperties } from "react";
import { HOME_STATS } from "../stats";
import { THREADS } from "../story";

const stats = (core: number): readonly { count: number; label: string; note: string; color: string }[] => [
  { count: HOME_STATS.modules, label: "modules", note: `${core} are always on. The rest are switches.`, color: "var(--th-attendance)" },
  { count: HOME_STATS.aiSkills, label: "AI skills", note: "Each one a switch, per role.", color: "var(--th-exams)" },
  { count: HOME_STATS.roles, label: "roles", note: "Each person signs in to their own view.", color: "var(--th-fees)" },
  { count: HOME_STATS.studyLanguages, label: "languages", note: "For the student's study assistant.", color: "var(--th-learning)" },
];

/** One row of the ribbon: the list twice, so the loop has no seam. */
function Track({ labels, reverse }: { labels: readonly string[]; reverse?: boolean }) {
  return (
    <div className="lh-ribbon-track" data-reverse={reverse || undefined}>
      {[0, 1].map((copy) => (
        <ul key={copy}>
          {labels.map((label, i) => (
            <li key={label} style={{ "--thread": THREADS[i % THREADS.length].color } as CSSProperties}>
              <span className="lh-tab-bead" />
              {label}
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}

/**
 * What is in the box, counted: every module name running past on two ribbons, then four counts. The counts
 * are catalog sizes (stats.ts), not usage figures. The ribbon is decoration: the module quilt further down
 * is the readable list, so the ribbon is hidden from assistive technology.
 */
export function Stats({ moduleLabels, core }: { moduleLabels: readonly string[]; core: number }) {
  const half = Math.ceil(moduleLabels.length / 2);
  return (
    <section className="lh-band" aria-label="Fabric in numbers">
      <div className="lh-ribbon" aria-hidden="true">
        <Track labels={moduleLabels.slice(0, half)} />
        <Track labels={moduleLabels.slice(half)} reverse />
      </div>
      <ul className="lh-stats">
        {stats(core).map((s, i) => (
          <li key={s.label} className="lh-stat lm-card" data-reveal="pop" style={{ "--i": i, "--thread": s.color } as CSSProperties}>
            <p className="lh-stat-top">
              <span className="lm-display lh-stat-num" data-count={s.count}>
                {s.count}
              </span>
              <span className="lh-stat-label">{s.label}</span>
            </p>
            <p className="lh-stat-note">{s.note}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
