// Static SVG rendition of the FabricOS system. Server-rendered as the first
// paint under the 3D canvas, and the permanent visual when motion is reduced,
// WebGL is missing or the device is low-power. Story stages show and hide
// parts through CSS (`data-min` vs the wrapper's `data-stage`), see hero.css.
import { NODES } from "./content";
import { EDGES, KIND_COLOR, POS, controlPoint, nodeStep, type Vec3 } from "./scene/layout";

/** Oblique projection that matches the 3D camera's default view closely enough. */
const P = (v: Vec3) => [+(v[0] + v[2] * 0.18).toFixed(3), +(-v[1] + v[2] * 0.1).toFixed(3)] as const;

const SATS = [
  [0.3, -0.18],
  [-0.26, 0.22],
  [0.08, 0.34],
] as const;

export function HeroFallback({ selected }: { selected?: string | null }) {
  const outer = NODES.filter((n) => n.id !== "core");
  return (
    <svg className="fos-fb" viewBox="-4 -3.25 8 6.5" preserveAspectRatio="xMidYMid meet" aria-hidden focusable="false">
      <defs>
        <radialGradient id="fos-fb-core">
          <stop offset="0" stopColor="#67d7ea" stopOpacity="0.55" />
          <stop offset="0.35" stopColor="#8b93ff" stopOpacity="0.22" />
          <stop offset="1" stopColor="#8b93ff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="fos-fb-glow">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.45" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>

      <g className="fos-fb__edges" fill="none">
        {EDGES.map((e) => {
          const [ax, ay] = P(POS[e.a]);
          const [bx, by] = P(POS[e.b]);
          const [cx, cy] = P(controlPoint(POS[e.a], POS[e.b]));
          const hot = selected != null && (e.a === selected || e.b === selected);
          return (
            <path
              key={`${e.a}-${e.b}`}
              data-min={e.step}
              className={hot ? "is-hot" : undefined}
              d={`M${ax} ${ay}Q${cx} ${cy} ${bx} ${by}`}
            />
          );
        })}
      </g>

      <g data-min={0} className={selected === "core" ? "fos-fb__core is-sel" : "fos-fb__core"}>
        <circle r="1.9" fill="url(#fos-fb-core)" />
        {[1.15, 1.5, 1.95].map((rx, i) => (
          <ellipse key={rx} rx={rx} ry={rx * 0.34} transform="rotate(-14)" className={`fos-fb__ring fos-fb__ring--${i}`} />
        ))}
        <polygon className="fos-fb__facet" points="0,-0.52 0.45,-0.26 0.45,0.26 0,0.52 -0.45,0.26 -0.45,-0.26" />
        <polygon className="fos-fb__facet fos-fb__facet--in" points="0,-0.26 0.22,-0.13 0.22,0.13 0,0.26 -0.22,0.13 -0.22,-0.13" />
      </g>

      {outer.map((n) => {
        const [x, y] = P(POS[n.id]);
        return (
          <g
            key={n.id}
            data-min={nodeStep(n.id)}
            className={selected === n.id ? "fos-fb__node is-sel" : "fos-fb__node"}
            transform={`translate(${x} ${y})`}
            style={{ color: KIND_COLOR[n.kind] }}
          >
            <circle r="0.6" fill="url(#fos-fb-glow)" />
            <circle r="0.12" fill="currentColor" />
            {SATS.map(([sx, sy]) => (
              <circle key={sx} cx={sx} cy={sy} r="0.035" fill="currentColor" opacity="0.7" />
            ))}
            <text y="0.5" textAnchor="middle" className="fos-fb__label">
              {n.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
