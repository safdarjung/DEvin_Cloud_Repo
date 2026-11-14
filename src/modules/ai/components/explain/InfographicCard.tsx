"use client";

// /infographic result: a one-page poster (4:5, or a wide 16:9 layout) in one
// of five fixed palettes, light and dark, blocks numbered in reading order.
// Charts use Recharts with a text summary for screen readers. The poster lays
// out by its own width (container queries), so a narrow orb panel or a phone
// gets one column instead of a clipped grid. "Open" shows it full size;
// "Save picture" is a PNG (html-to-image, loaded on click) and "Save as PDF"
// prints that picture fitted to one page. Plain text only: React escapes everything.
import { useRef, useState, type RefObject } from "react";
import { Download, Loader2, Maximize2, Printer, Sparkles } from "lucide-react";
import { Bar, BarChart, Cell, LabelList, Pie, PieChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ProviderBadge } from "@/modules/ai/components/ProviderBadge";
import type { InfographicBlock, InfographicPalette, InfographicResponse } from "@/modules/ai/explain/schemas";

export type InfographicResult = Extract<InfographicResponse, { refused: false }>;

export interface InfographicCardProps {
  result: InfographicResult;
  /** Starting layout; the person can switch. */
  variant?: "poster" | "wide";
}

type Tokens = [bg: string, panel: string, ink: string, muted: string, accent: string, onAccent: string, rule: string];
// Each pair is [light, dark]; ink, muted and accent meet WCAG AA on bg and panel, onAccent on accent.
const PALETTES: Record<InfographicPalette, [Tokens, Tokens]> = {
  ocean: [
    ["#E8F3F7", "#FFFFFF", "#0B2733", "#3D5A66", "#0E6E8C", "#FFFFFF", "#C9E0E8"],
    ["#0A1A21", "#10262F", "#E3F2F7", "#9DBAC5", "#4FB3D1", "#06161C", "#1E3B47"],
  ],
  forest: [
    ["#ECF4E9", "#FFFFFF", "#142B19", "#3F5A45", "#2E7A3A", "#FFFFFF", "#CFE2CB"],
    ["#0D1A10", "#142719", "#E3F1E5", "#9FBFA5", "#6CC27A", "#0A1A0E", "#22402A"],
  ],
  sunrise: [
    ["#FFF3E6", "#FFFFFF", "#36200A", "#6B4A2B", "#B9520B", "#FFFFFF", "#F2D9BF"],
    ["#1E1206", "#2A1A0B", "#FCEBD9", "#D2B394", "#F59E4B", "#1E1206", "#4A3018"],
  ],
  berry: [
    ["#FBEDF3", "#FFFFFF", "#3A0F24", "#6E3D55", "#A3245E", "#FFFFFF", "#F0D2DF"],
    ["#1F0D16", "#2B1320", "#F8E5EE", "#D2A6BB", "#E0679E", "#1F0D16", "#4A2537"],
  ],
  ink: [
    ["#F3F2EE", "#FFFFFF", "#111111", "#4A4A4A", "#B42318", "#FFFFFF", "#DEDCD5"],
    ["#111111", "#1B1B1B", "#F2F2F2", "#B3B3B3", "#F2685C", "#111111", "#333333"],
  ],
};
const NAMES = ["bg", "panel", "ink", "muted", "accent", "on-accent", "rule"];
const vars = (t: Tokens) => t.map((v, i) => `--ig-${NAMES[i]}:${v}`).join(";");
// Static CSS from the constants above (no user text).
const CSS = Object.entries(PALETTES)
  .map(([name, [light, dark]]) => `[data-ig=${name}]{${vars(light)}}@media screen{.dark [data-ig=${name}]{${vars(dark)}}}`)
  .join("");

const num = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });
const label = "font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--ig-muted)]";

/** Columns a block wants: 1 for compact blocks, 2 for wide ones, 0 for the full row. */
function want(b: InfographicBlock): number {
  switch (b.type) {
    case "stat":
      return 1;
    case "callout":
      return 0;
    case "chart":
      return b.kind === "pie" || b.series.length <= 4 ? 1 : 2;
    case "steps":
    case "parts":
      return b.items.length <= 4 ? 1 : 2;
    default:
      return 2;
  }
}

/** Fills rows in reading order: a block that leaves a gap before the next row is widened to close it. */
export function packSpans(wants: readonly number[], cols: number): number[] {
  const spans = wants.map((w) => (w === 0 ? cols : Math.min(w, cols)));
  let used = 0;
  spans.forEach((s, i) => {
    if (used > 0 && used + s > cols) spans[i - 1] += cols - used;
    if (used + s > cols) used = 0;
    used = (used + s) % cols;
  });
  if (used > 0) spans[spans.length - 1] += cols - used;
  return spans;
}

// Literal class names so Tailwind sees them.
// Container sizes, not screen sizes: two columns from 32rem of poster width, three (wide) from 48rem.
const SM_SPAN: Record<number, string> = { 1: "", 2: "@lg:col-span-2" };
const LG_SPAN: Record<number, string> = { 1: "@3xl:col-span-1", 2: "@3xl:col-span-2", 3: "@3xl:col-span-3" };

function Heading({ n, text }: { n: number; text: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-2">
      <span className={label}>{String(n).padStart(2, "0")}</span>
      {text && <h3 className="text-base font-bold leading-tight tracking-tight">{text}</h3>}
    </div>
  );
}

function Chart({ b }: { b: Extract<InfographicBlock, { type: "chart" }> }) {
  const total = b.series.reduce((s, x) => s + x.value, 0);
  const shade = (i: number) => (i % 2 === 0 ? "var(--ig-accent)" : "var(--ig-ink)");
  const opacity = (i: number) => Math.max(0.25, 1 - Math.floor(i / 2) * 0.28);
  return (
    <figure className="min-w-0">
      <figcaption className="sr-only">{b.series.map((s) => `${s.label}: ${num.format(s.value)}`).join("; ")}</figcaption>
      {b.kind === "pie" ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="aspect-square w-28 shrink-0" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={b.series} dataKey="value" nameKey="label" innerRadius="52%" outerRadius="98%" stroke="var(--ig-panel)" strokeWidth={2} isAnimationActive={false}>
                  {b.series.map((s, i) => (
                    <Cell key={s.label} fill={shade(i)} fillOpacity={opacity(i)} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="min-w-[9rem] flex-1 space-y-1.5 text-sm" aria-hidden>
            {b.series.map((s, i) => (
              <li key={s.label} className="flex items-baseline gap-2 leading-snug">
                <span className="size-2.5 shrink-0 translate-y-px rounded-full" style={{ background: shade(i), opacity: opacity(i) }} />
                <span className="min-w-0 flex-1">{s.label}</span>
                <span className="font-mono text-xs tabular-nums text-[var(--ig-muted)]">{total > 0 ? `${pct.format((s.value / total) * 100)}%` : num.format(s.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div style={{ height: b.series.length * 34 + 8 }} aria-hidden>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={b.series} layout="vertical" margin={{ top: 0, right: 44, bottom: 0, left: 0 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="label" width={104} axisLine={false} tickLine={false} tick={{ fill: "var(--ig-ink)", fontSize: 12 }} />
              <Bar dataKey="value" fill="var(--ig-accent)" radius={[0, 6, 6, 0]} barSize={16} isAnimationActive={false}>
                <LabelList dataKey="value" position="right" fill="var(--ig-ink)" fontSize={12} formatter={(v) => num.format(Number(v))} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  );
}

function Block({ b, n }: { b: InfographicBlock; n: number }) {
  switch (b.type) {
    case "stat":
      return (
        <>
          <span className={label}>{String(n).padStart(2, "0")}</span>
          <div className="mt-auto pt-4">
            <p className="text-[2.6rem] font-black leading-none tracking-[-0.04em] text-[var(--ig-accent)] [overflow-wrap:anywhere] @3xl:text-[3.25rem]">{b.value}</p>
            <p className="mt-2 text-sm font-medium leading-snug">{b.label}</p>
          </div>
        </>
      );
    case "callout":
      return (
        <>
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] opacity-80">{String(n).padStart(2, "0")}</span>
          <p className="mt-1 text-xl font-bold leading-snug tracking-tight text-balance @lg:text-2xl">{b.text}</p>
        </>
      );
    case "steps":
      return (
        <>
          <Heading n={n} text={b.heading} />
          <ol className="space-y-2">
            {b.items.map((t, i) => (
              <li key={i} className="flex gap-2.5 text-sm leading-snug">
                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--ig-accent)] font-mono text-[11px] font-bold text-[var(--ig-on-accent)]">{i + 1}</span>
                <span className="pt-0.5">{t}</span>
              </li>
            ))}
          </ol>
        </>
      );
    case "compare":
      return (
        <>
          <Heading n={n} text={b.heading} />
          <table className="w-full table-fixed border-collapse text-sm">
            <thead>
              <tr>
                <th className="w-[30%]" />
                <th scope="col" className="pb-2 text-left">
                  <span className="inline-block rounded-full bg-[var(--ig-accent)] px-2.5 py-0.5 text-xs font-bold text-[var(--ig-on-accent)]">{b.left}</span>
                </th>
                <th scope="col" className="pb-2 text-left">
                  <span className="inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ring-[var(--ig-ink)]">{b.right}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i} className="border-t border-[var(--ig-rule)] align-top">
                  <th scope="row" className={cn(label, "py-2 pr-2 text-left leading-relaxed")}>
                    {r.aspect}
                  </th>
                  <td className="py-2 pr-2 leading-snug">{r.left}</td>
                  <td className="py-2 leading-snug">{r.right}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      );
    case "timeline":
      return (
        <>
          <Heading n={n} text={b.heading} />
          <ol className="relative ml-1.5 space-y-3 border-l-2 border-[var(--ig-accent)] pl-4">
            {b.events.map((e, i) => (
              <li key={i} className="relative text-sm leading-snug">
                <span aria-hidden className="absolute -left-[23px] top-1 size-3 rounded-full border-2 border-[var(--ig-accent)] bg-[var(--ig-panel)]" />
                <span className="font-mono text-xs font-bold text-[var(--ig-accent)]">{e.when}</span> {e.what}
              </li>
            ))}
          </ol>
        </>
      );
    case "parts":
      return (
        <>
          <Heading n={n} text={b.heading} />
          <dl className={cn("grid gap-x-5 gap-y-2.5", b.items.length > 4 && "@lg:grid-cols-2")}>
            {b.items.map((p, i) => (
              <div key={i} className="text-sm leading-snug">
                <dt className="font-bold">{p.name}</dt>
                <dd className="text-[var(--ig-muted)]">{p.role}</dd>
              </div>
            ))}
          </dl>
        </>
      );
    case "chart":
      return (
        <>
          <Heading n={n} text={b.heading} />
          <Chart b={b} />
        </>
      );
  }
}

const fileName = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "infographic";

/** The poster as a PNG data URL, at least 1200px wide whatever size it is shown at. */
async function posterPng(el: HTMLElement): Promise<string> {
  const { toPng } = await import("html-to-image");
  return toPng(el, { pixelRatio: Math.max(2, 1200 / Math.max(1, el.offsetWidth)), cacheBust: true });
}

/** Prints one picture fitted to a page from a hidden frame (no pop-up, nothing else on the page prints). */
function printPicture(src: string, title: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.append(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) return frame.remove();
  doc.open();
  doc.write("<!doctype html><style>@page{margin:10mm}html,body{margin:0}img{display:block;width:100%;height:auto;max-height:100vh;object-fit:contain}</style>");
  doc.close();
  doc.title = title;
  const img = doc.createElement("img");
  img.alt = title;
  img.addEventListener(
    "load",
    () => {
      win.addEventListener("afterprint", () => frame.remove(), { once: true });
      win.focus();
      win.print();
      setTimeout(() => frame.remove(), 60_000);
    },
    { once: true },
  );
  img.src = src;
  doc.body.append(img);
}

function Poster({ ig, wide, posterRef }: { ig: InfographicResult["infographic"]; wide: boolean; posterRef: RefObject<HTMLDivElement | null> }) {
  const sm = packSpans(ig.blocks.map(want), 2);
  const lg = packSpans(ig.blocks.map(want), 3);
  return (
    <div
      ref={posterRef}
      data-ig={ig.palette}
      className={cn(
        // overflow-clip, not hidden: a scroll container loses aspect-ratio's grow-to-fit-content minimum.
        // No fixed shape when narrow (a phone): the poster is as tall as its content.
        "relative isolate mx-auto w-full overflow-clip rounded-[20px] bg-[var(--ig-bg)] text-[var(--ig-ink)] shadow-[0_1px_0_var(--ig-rule),0_28px_56px_-28px_rgb(0_0_0/0.35)]",
        wide ? "@3xl:aspect-[16/9]" : "max-w-[600px] @lg:aspect-[4/5]",
      )}
    >
      <div aria-hidden className="pointer-events-none absolute -right-28 -top-28 -z-10 size-80 rounded-full bg-[var(--ig-accent)] opacity-[0.13]" />
      <div aria-hidden className="pointer-events-none absolute -bottom-20 -left-16 -z-10 size-56 rounded-full border-[28px] border-[var(--ig-accent)] opacity-[0.07]" />
      <header className={cn("px-5 pt-6 @lg:px-9 @lg:pt-9", wide && "@3xl:grid @3xl:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] @3xl:items-end @3xl:gap-10")}>
        <div>
          <p className={label}>Infographic</p>
          <h2 className="mt-2 max-w-[16ch] text-[1.9rem] font-black leading-[0.95] tracking-[-0.03em] text-balance [overflow-wrap:anywhere] @sm:text-[2.35rem] @lg:text-[3.25rem]">{ig.title}</h2>
        </div>
        {ig.subtitle && <p className="mt-3 max-w-[46ch] text-[15px] font-medium leading-snug text-[var(--ig-muted)]">{ig.subtitle}</p>}
        <div aria-hidden className="mt-5 h-1.5 w-14 rounded-full bg-[var(--ig-accent)] @3xl:col-span-2" />
      </header>
      <ol className={cn("grid gap-3 px-3 pb-4 pt-5 @lg:grid-cols-2 @lg:px-7", wide && "@3xl:grid-cols-3")}>
        {ig.blocks.map((b, i) => (
          <li
            key={i}
            data-block={b.type}
            className={cn(
              "flex min-w-0 flex-col rounded-2xl p-4 @lg:p-5",
              b.type === "callout" ? "bg-[var(--ig-accent)] text-[var(--ig-on-accent)]" : "bg-[var(--ig-panel)] ring-1 ring-[var(--ig-rule)]",
              SM_SPAN[sm[i]],
              wide && LG_SPAN[lg[i]],
            )}
          >
            <Block b={b} n={i + 1} />
          </li>
        ))}
      </ol>
      <footer className="flex items-center gap-2 px-5 pb-6 text-[11px] leading-snug text-[var(--ig-muted)] @lg:px-9">
        <Sparkles className="size-3 shrink-0" aria-hidden />
        {ig.sources_note}
      </footer>
    </div>
  );
}

export function InfographicCard({ result, variant = "poster" }: InfographicCardProps) {
  const ig = result.infographic;
  const [layout, setLayout] = useState(variant);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"png" | "pdf" | null>(null);
  const [failed, setFailed] = useState(false);
  const poster = useRef<HTMLDivElement>(null);
  const big = useRef<HTMLDivElement>(null);
  const wide = layout === "wide";

  // The full-size copy when it is open (larger, so a sharper file), else the one in the card.
  async function save(kind: "png" | "pdf") {
    const el = (open && big.current) || poster.current;
    if (!el || busy) return;
    setBusy(kind);
    setFailed(false);
    try {
      const png = await posterPng(el);
      if (kind === "pdf") printPicture(png, ig.title);
      else {
        const a = document.createElement("a");
        a.href = png;
        a.download = `${fileName(ig.title)}.png`;
        a.click();
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  const actions = (
    <div className="flex flex-wrap items-center gap-1.5">
      <div role="group" aria-label="Layout" className="inline-flex rounded-full border bg-background p-0.5">
        {(["poster", "wide"] as const).map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={layout === l}
            onClick={() => setLayout(l)}
            className={cn(
              "min-h-11 rounded-full px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring md:min-h-7 motion-reduce:transition-none",
              layout === l ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {l === "poster" ? "Poster 4:5" : "Wide"}
          </button>
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => void save("png")} disabled={busy !== null}>
        {busy === "png" ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
        Save picture
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => void save("pdf")} disabled={busy !== null}>
        {busy === "pdf" ? <Loader2 className="animate-spin" aria-hidden /> : <Printer aria-hidden />}
        Save as PDF
      </Button>
    </div>
  );

  return (
    <div className="@container space-y-3">
      <style>{CSS}</style>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="gap-1">
            <Sparkles className="size-3" aria-hidden />
            AI-generated poster
          </Badge>
          <ProviderBadge provider={result.provider} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
            <Maximize2 aria-hidden />
            Open
          </Button>
          {actions}
        </div>
      </div>
      {failed && (
        <p role="alert" className="text-xs text-destructive">
          This browser could not make the picture. Use Open and take a screenshot instead.
        </p>
      )}

      {/* The whole poster in the card. A click opens it full size: a mouse shortcut only (a poster of
          headings and tables cannot sit inside a button); the Open button is the keyboard path. */}
      <div onClick={() => setOpen(true)} className="cursor-zoom-in">
        <Poster ig={ig} wide={wide} posterRef={poster} />
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[94dvh] w-[98vw] max-w-[98vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[98vw]">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 pr-12">
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-sm font-semibold">{ig.title}</DialogTitle>
              <DialogDescription className="text-xs">The infographic at full size. Scroll to see all of it.</DialogDescription>
            </div>
            {actions}
          </div>
          <div className="min-h-0 flex-1 overflow-auto bg-muted/40 p-3 sm:p-6" tabIndex={0}>
            <div className={cn("@container mx-auto", wide ? "max-w-[1280px]" : "max-w-[640px]")}>
              <Poster ig={ig} wide={wide} posterRef={big} />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
