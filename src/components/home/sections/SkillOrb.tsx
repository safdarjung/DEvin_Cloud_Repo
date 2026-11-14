"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

export type SkillGroup = "teacher" | "student" | "parent" | "office";
export interface Skill {
  label: string;
  description: string;
  group: SkillGroup;
  /** True when the skill prepares a draft for a person to save; false when it only reads. */
  drafts: boolean;
}

export const SKILL_GROUPS: readonly { key: SkillGroup; label: string; color: string }[] = [
  { key: "teacher", label: "Teacher", color: "#00C853" },
  { key: "student", label: "Student", color: "#2979FF" },
  { key: "parent", label: "Parent", color: "#FF2D95" },
  { key: "office", label: "Office and leadership", color: "#FF6B35" },
];
const COLOR = Object.fromEntries(SKILL_GROUPS.map((g) => [g.key, g.color])) as Record<SkillGroup, string>;

/** n points spread evenly over a unit sphere. */
function fibonacci(n: number): [number, number, number][] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: n }, (_, i) => {
    const y = 1 - ((i + 0.5) / n) * 2;
    const r = Math.sqrt(1 - y * y);
    return [Math.cos(golden * i) * r, y, Math.sin(golden * i) * r];
  });
}

/**
 * Every AI skill as a dot on a ball you can spin and fling. Hover or tap a dot to read what it does.
 * The dots are plain buttons moved with transforms (no second WebGL context); the full list below the
 * ball is the keyboard and screen-reader path.
 */
export function SkillOrb({ skills }: { skills: readonly Skill[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const dots = useRef<(HTMLButtonElement | null)[]>([]);
  const [group, setGroup] = useState<SkillGroup | "all">("all");
  const [picked, setPicked] = useState<number | null>(null);
  const points = useMemo(() => fibonacci(skills.length), [skills.length]);
  const spin = useRef({ yaw: 0.4, pitch: -0.25, vy: 0.003, vp: 0, drag: false, moved: 0, x: 0, y: 0, hover: false });

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const s = spin.current;
    let raf = 0;
    let visible = false;
    const draw = () => {
      raf = 0;
      const radius = el.clientWidth * 0.41;
      if (!s.drag) {
        s.yaw += s.vy;
        s.pitch += s.vp;
        // Ease back to a slow idle turn; stand still while a dot is being read.
        s.vy += ((reduced || s.hover ? 0 : 0.0028) - s.vy) * 0.035;
        s.vp *= 0.93;
      }
      s.pitch = Math.max(-1.15, Math.min(1.15, s.pitch));
      const cy = Math.cos(s.yaw);
      const sy = Math.sin(s.yaw);
      const cp = Math.cos(s.pitch);
      const sp = Math.sin(s.pitch);
      for (let i = 0; i < points.length; i++) {
        const dot = dots.current[i];
        if (!dot) continue;
        const [x, y, z] = points[i];
        const x1 = x * cy + z * sy;
        const z1 = -x * sy + z * cy;
        const y1 = y * cp - z1 * sp;
        const depth = (y * sp + z1 * cp + 1) / 2; // 0 at the back, 1 at the front
        dot.style.transform = `translate3d(${(x1 * radius).toFixed(1)}px, ${(y1 * radius).toFixed(1)}px, 0) scale(${(0.5 + depth * 0.8).toFixed(3)})`;
        dot.style.zIndex = String(Math.round(depth * 100));
        dot.style.opacity = (0.3 + depth * 0.7).toFixed(2);
      }
      if (visible && !(reduced && !s.drag && Math.abs(s.vy) < 1e-4)) raf = requestAnimationFrame(draw);
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    const seen = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) kick();
    });
    seen.observe(el);

    const down = (e: PointerEvent) => {
      s.drag = true;
      s.moved = 0;
      s.x = e.clientX;
      s.y = e.clientY;
    };
    const move = (e: PointerEvent) => {
      if (!s.drag) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      s.x = e.clientX;
      s.y = e.clientY;
      s.moved += Math.abs(dx) + Math.abs(dy);
      s.yaw += dx * 0.008;
      s.pitch += dy * 0.008;
      s.vy = dx * 0.008;
      s.vp = dy * 0.008;
      kick();
    };
    const up = () => {
      s.drag = false;
      kick();
    };
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerup", up);
    // A vertical swipe that starts on the ball is taken over by the browser: it ends in pointercancel, not pointerup.
    window.addEventListener("pointercancel", up);
    return () => {
      cancelAnimationFrame(raf);
      seen.disconnect();
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [points]);

  const shown = picked === null ? null : skills[picked];
  const count = (g: SkillGroup) => skills.filter((s) => s.group === g).length;

  return (
    <div className="lh-orb">
      <div className="lh-orb-filters" role="group" aria-label="Show skills for">
        <button type="button" className="lh-filter lm-focus" aria-pressed={group === "all"} onClick={() => setGroup("all")}>
          All {skills.length}
        </button>
        {SKILL_GROUPS.map((g) => (
          <button key={g.key} type="button" className="lh-filter lm-focus" aria-pressed={group === g.key} style={{ "--thread": g.color } as CSSProperties} onClick={() => setGroup(g.key)}>
            <span className="lh-tab-bead" aria-hidden="true" />
            {g.label} {count(g.key)}
          </button>
        ))}
      </div>

      <div
        ref={wrap}
        className="lh-orb-ball"
        aria-hidden="true"
        onPointerEnter={() => {
          spin.current.hover = true;
        }}
        onPointerLeave={() => {
          spin.current.hover = false;
        }}
      >
        <span className="lh-orb-core" />
        {skills.map((s, i) => (
          <button
            key={s.label + i}
            ref={(node) => {
              dots.current[i] = node;
            }}
            type="button"
            tabIndex={-1}
            className="lh-dot"
            data-dim={group !== "all" && group !== s.group ? "true" : undefined}
            data-picked={picked === i || undefined}
            data-drafts={s.drafts || undefined}
            style={{ "--thread": COLOR[s.group] } as CSSProperties}
            onPointerEnter={() => setPicked(i)}
            onClick={() => {
              if (spin.current.moved < 6) setPicked(i);
            }}
          />
        ))}
      </div>

      <div className="lh-orb-card lm-card" aria-live="polite">
        {shown ? (
          <>
            <p className="lh-orb-card-top">
              <span className="lm-chip" style={{ "--thread": COLOR[shown.group] } as CSSProperties}>
                <span className="lh-tab-bead" aria-hidden="true" />
                {SKILL_GROUPS.find((g) => g.key === shown.group)?.label}
              </span>
              <span className="lm-chip">{shown.drafts ? "Drafts for a person to save" : "Reads what this role may see"}</span>
            </p>
            <p className="lh-orb-card-title">{shown.label}</p>
            <p className="lh-orb-card-text">{shown.description}</p>
          </>
        ) : (
          <p className="lh-orb-card-text">
            <strong>Spin the ball.</strong> Each dot is one thing the AI can do today; a ringed dot prepares a draft. Point at one to read it.
          </p>
        )}
      </div>

      <details className="lh-orb-list">
        <summary className="lm-focus">Read all {skills.length} skills as a list</summary>
        {SKILL_GROUPS.map((g) => (
          <div key={g.key}>
            <h4>{g.label}</h4>
            <ul>
              {skills
                .filter((s) => s.group === g.key)
                .map((s, i) => (
                  <li key={s.label + i}>{s.label}</li>
                ))}
            </ul>
          </div>
        ))}
      </details>
    </div>
  );
}
