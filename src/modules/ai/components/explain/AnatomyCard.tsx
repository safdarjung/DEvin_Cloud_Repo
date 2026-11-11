"use client";

// /anatomy and /teardown result: an exploded diagram (inline SVG, parts
// numbered in reading order, lines for the parts that connect), the numbered
// parts key beside it, then how it works, failure points, things to try and
// common mistakes. Plain text only: React escapes everything.
import { FlaskConical, Images, Sparkles, TriangleAlert, Lightbulb } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProviderBadge } from "@/modules/ai/components/ProviderBadge";
import { SpeakButton } from "@/modules/ai/components/voice/SpeakButton";
import { explodedLayout } from "@/modules/ai/explain/diagram";
import { EXPLAIN_DEPTHS, type Anatomy, type AnatomyResponse, type ExplainDepth } from "@/modules/ai/explain/schemas";

export type AnatomyResult = Extract<AnatomyResponse, { refused: false }>;

export interface AnatomyCardProps {
  result: AnatomyResult;
  /** Re-run at another depth; the switch is hidden without it. */
  onDepthChange?: (depth: ExplainDepth) => void;
  /** Turn this explanation into a poster; the button is hidden without it. */
  onMakeInfographic?: () => void;
  /** A depth change or infographic is being made: the controls are disabled. */
  busy?: boolean;
}

const W = 600;
const H = 420;
const DEPTH_LABEL: Record<ExplainDepth, string> = { simple: "Simple", standard: "Standard", deep: "Deep" };
const eyebrow = "font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground";

const short = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

/** The title on up to two lines of about 12 characters, for the core of the diagram. */
function coreLines(title: string): string[] {
  const lines: string[] = [];
  for (const word of title.split(/\s+/)) {
    const last = lines.length - 1;
    if (last >= 0 && `${lines[last]} ${word}`.length <= 12) lines[last] = `${lines[last]} ${word}`;
    else lines.push(word);
  }
  return lines.length > 2 ? [lines[0], short(lines.slice(1).join(" "), 12)] : lines.map((l) => short(l, 13));
}

function ExplodedDiagram({ anatomy }: { anatomy: Anatomy }) {
  const { nodes, links } = explodedLayout(anatomy.parts, W, H);
  const cx = W / 2;
  const cy = H / 2;
  const core = coreLines(anatomy.title);
  return (
    // Phones: the box is narrower than the drawing and "slice" crops the empty label margins (labels are hidden there).
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={`Exploded view of ${anatomy.title}: ${anatomy.parts.map((p, i) => `${i + 1} ${p.name}`).join(", ")}`}
      className="mx-auto aspect-[34/42] w-full max-w-[680px] text-foreground sm:aspect-[60/42]"
    >
      {nodes.map((n) => (
        <line key={`g${n.n}`} x1={cx} y1={cy} x2={n.x} y2={n.y} stroke="currentColor" strokeOpacity={0.28} strokeWidth={1} strokeDasharray="2 5" />
      ))}
      {links.map(({ from, to }) => {
        const a = nodes[from];
        const b = nodes[to];
        // Bend each link toward the core so links between neighbours stay off the ring.
        const qx = (a.x + b.x) / 2 + (cx - (a.x + b.x) / 2) * 0.4;
        const qy = (a.y + b.y) / 2 + (cy - (a.y + b.y) / 2) * 0.4;
        return <path key={`l${from}-${to}`} data-link="" d={`M${a.x} ${a.y}Q${qx} ${qy} ${b.x} ${b.y}`} fill="none" stroke="currentColor" strokeOpacity={0.7} strokeWidth={1.75} />;
      })}
      <circle cx={cx} cy={cy} r={70} fill="none" stroke="currentColor" strokeOpacity={0.3} strokeDasharray="1 5" />
      <circle cx={cx} cy={cy} r={58} fill="var(--foreground)" />
      {core.map((l, i) => (
        <text key={i} x={cx} y={cy + 5 + (i - (core.length - 1) / 2) * 17} textAnchor="middle" fontSize={14} fontWeight={700} fill="var(--background)">
          {l}
        </text>
      ))}
      {nodes.map((n) => {
        const lx = n.anchor === "start" ? n.x + 28 : n.anchor === "end" ? n.x - 28 : n.x;
        const ly = n.anchor === "middle" ? (n.y < cy ? n.y - 30 : n.y + 40) : n.y + 5;
        return (
          <g key={n.n} data-part-node={n.n}>
            <circle cx={n.x} cy={n.y} r={20} fill="var(--card)" stroke="currentColor" strokeWidth={2} />
            <text x={n.x} y={n.y + 6} textAnchor="middle" fontSize={17} fontWeight={700} fill="currentColor" className="font-mono">
              {n.n}
            </text>
            <text
              x={lx}
              y={ly}
              textAnchor={n.anchor}
              fontSize={15}
              fontWeight={600}
              fill="currentColor"
              stroke="var(--card)"
              strokeWidth={5}
              strokeLinejoin="round"
              paintOrder="stroke"
              className="max-sm:hidden"
            >
              {short(n.name, 16)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function DepthSwitch({ depth, onChange, busy }: { depth: ExplainDepth; onChange: (d: ExplainDepth) => void; busy?: boolean }) {
  return (
    <div role="group" aria-label="Depth" className="inline-flex rounded-full border bg-background p-0.5">
      {EXPLAIN_DEPTHS.map((d) => (
        <button
          key={d}
          type="button"
          aria-pressed={d === depth}
          disabled={busy}
          onClick={() => d !== depth && onChange(d)}
          className={cn(
            "min-h-11 rounded-full px-3.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 md:min-h-7 motion-reduce:transition-none",
            d === depth ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {DEPTH_LABEL[d]}
        </button>
      ))}
    </div>
  );
}

export function AnatomyCard({ result, onDepthChange, onMakeInfographic, busy }: AnatomyCardProps) {
  const a = result.anatomy;
  const spoken = [a.title, a.summary, ...a.howItWorks].join(". ");
  return (
    <article className="overflow-hidden rounded-xl border bg-card text-card-foreground" aria-busy={busy || undefined}>
      <header className="border-b px-5 pb-6 pt-5 sm:px-8 sm:pt-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={eyebrow}>
            {result.mode === "teardown" ? "Teardown" : "Anatomy"} · {a.parts.length} parts
          </p>
          {onDepthChange && <DepthSwitch depth={result.depth} onChange={onDepthChange} busy={busy} />}
        </div>
        <h2 className="mt-3 text-[2rem] font-semibold leading-[1.02] tracking-[-0.02em] text-balance sm:text-[2.75rem]">{a.title}</h2>
        <p className="mt-3 max-w-[64ch] text-[15px] leading-relaxed text-muted-foreground">{a.summary}</p>
      </header>

      <section aria-label="Parts" className="grid border-b lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="flex items-center border-b bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:18px_18px] p-3 sm:p-6 lg:border-b-0 lg:border-r">
          <ExplodedDiagram anatomy={a} />
        </div>
        <ol className="divide-y">
          {a.parts.map((p, i) => (
            <li key={p.name} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 px-5 py-3.5 sm:px-6">
              <span className="mt-0.5 inline-flex size-7 items-center justify-center rounded-full border-2 border-foreground font-mono text-xs font-bold tabular-nums">{i + 1}</span>
              <div className="min-w-0">
                <p className="font-semibold leading-snug">{p.name}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{p.role}</p>
                {(p.madeOf || p.connectsTo.length > 0) && (
                  <p className="mt-1.5 font-mono text-[11px] uppercase leading-relaxed tracking-wide text-muted-foreground">
                    {p.madeOf && <span>Made of · {p.madeOf}</span>}
                    {p.madeOf && p.connectsTo.length > 0 && <span aria-hidden> &nbsp;/&nbsp; </span>}
                    {p.connectsTo.length > 0 && (
                      <span className="whitespace-nowrap">Links to · {p.connectsTo.map((c) => a.parts.findIndex((q) => q.name === c) + 1).join(", ")}</span>
                    )}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="how-it-works" className="px-5 py-6 sm:px-8">
        <h3 id="how-it-works" className={eyebrow}>
          How it works
        </h3>
        <ol className="mt-4 grid gap-x-8 md:grid-cols-2">
          {a.howItWorks.map((step, i) => (
            <li key={i} className="relative grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 pb-5">
              <span className="font-mono text-2xl font-bold leading-none tabular-nums text-foreground/25">{String(i + 1).padStart(2, "0")}</span>
              <p className="border-t pt-2 text-[15px] leading-relaxed">{step}</p>
            </li>
          ))}
        </ol>
      </section>

      {(a.failurePoints.length > 0 || a.tryThis.length > 0 || a.misconceptions.length > 0) && (
        <div className="grid border-t md:grid-cols-2">
          {a.failurePoints.length > 0 && (
            <section aria-labelledby="fails" className="border-b px-5 py-6 sm:px-8 md:border-b-0 md:border-r">
              <h3 id="fails" className={cn(eyebrow, "flex items-center gap-1.5")}>
                <TriangleAlert className="size-3.5 text-[var(--chart-negative)]" aria-hidden /> What goes wrong
              </h3>
              <ul className="mt-4 space-y-4">
                {a.failurePoints.map((f, i) => (
                  <li key={i} className="border-l-2 border-[var(--chart-negative)] pl-3">
                    <p className="font-semibold leading-snug">{f.what}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{f.why}</p>
                    <p className="mt-1 text-sm">
                      <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">You notice · </span>
                      {f.sign}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <div className="space-y-6 px-5 py-6 sm:px-8">
            {a.tryThis.length > 0 && (
              <section aria-labelledby="try">
                <h3 id="try" className={cn(eyebrow, "flex items-center gap-1.5")}>
                  <FlaskConical className="size-3.5" aria-hidden /> Try this
                </h3>
                <ul className="mt-3 space-y-2">
                  {a.tryThis.map((t, i) => (
                    <li key={i} className="rounded-lg bg-muted/60 px-3 py-2 text-sm leading-relaxed">
                      {t}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {a.misconceptions.length > 0 && (
              <section aria-labelledby="myths">
                <h3 id="myths" className={cn(eyebrow, "flex items-center gap-1.5")}>
                  <Lightbulb className="size-3.5" aria-hidden /> Common mix-ups
                </h3>
                <ul className="mt-3 list-disc space-y-1.5 pl-4 text-sm leading-relaxed marker:text-muted-foreground">
                  {a.misconceptions.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      )}

      <footer className="flex flex-wrap items-center gap-2 border-t bg-muted/40 px-5 py-3 sm:px-8">
        <Badge variant="secondary" className="gap-1">
          <Sparkles className="size-3" aria-hidden />
          AI-generated: check before you rely on it
        </Badge>
        <ProviderBadge provider={result.provider} />
        {a.gradeLevelNote && <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{a.gradeLevelNote}</span>}
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <SpeakButton text={spoken} lang={result.language === "hi" ? "hi-IN" : "en-IN"} />
          {onMakeInfographic && (
            <Button type="button" size="sm" onClick={onMakeInfographic} disabled={busy}>
              <Images aria-hidden />
              Make an infographic
            </Button>
          )}
        </span>
      </footer>
    </article>
  );
}
