"use client";

// /mindmap, /diagram and /image results. The first two are real drawings (inline SVG from the layouts in
// explain/visuals.ts), not chat text. The card shows the whole drawing fitted to
// its width; "Open" shows it at its own size in a large dialog that scrolls
// (starting on the middle). Each can be saved as a PNG or SVG and says where it came from
// (rule 7). The SVG carries its own paper, colours and fonts so a saved file looks
// like the card. A picture from /image is shown from the bytes in the answer.
// Nothing is stored on the server.
import { useId, useRef, useState } from "react";
import { Download, GitFork, ImageIcon, Maximize2, Network } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ProviderBadge } from "@/modules/ai/components/ProviderBadge";
import { SOURCES_NOTE, type AiMeta, type Flow, type MindMap } from "@/modules/ai/explain/schemas";
import { flowLayout, mindMapLayout, type FlowBox, type MapNode } from "@/modules/ai/explain/visuals";

export type MindMapResult = { mindmap: MindMap } & AiMeta;
export type DiagramResult = { flow: Flow } & AiMeta;
export type ImageResult = { prompt: string; image: { base64: string; mediaType: string } } & AiMeta;

const PAPER = "#FBFAF7";
const INK = "#1B1D22";
const MUTED = "#5B6170";
const FONT = "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif";
/** One colour per branch, in turn. */
const HUES = ["#2563EB", "#DB2777", "#059669", "#D97706", "#7C3AED", "#0891B2", "#DC2626", "#4D7C0F"];
const PNG_SCALE = 2;

const fileName = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "drawing";

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  // The click has started the download by the time this runs.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const svgBlob = (svg: SVGSVGElement) => new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml;charset=utf-8" });

/** The drawing as a PNG at twice its size; rejects when the browser cannot rasterise it. */
function pngBlob(svg: SVGSVGElement, width: number, height: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(svgBlob(svg));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width * PNG_SCALE;
      canvas.height = height * PNG_SCALE;
      canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no image"))), "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("no image"));
    };
    img.src = url;
  });
}

/** The card round a drawing: what it is, its title, where it came from, the save buttons and the facts note. */
function Frame({ kind, Icon, title, meta, width, height, children }: {
  kind: string;
  Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  meta: AiMeta;
  width: number;
  height: number;
  children: (ref: React.RefObject<SVGSVGElement | null>) => React.ReactNode;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const big = useRef<SVGSVGElement>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  // A wide drawing opens on its middle (a mind map's centre), not its top-left corner.
  const centre = (el: HTMLDivElement | null) => {
    if (!el) return;
    el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
    el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
  };
  const name = fileName(title);

  async function savePng() {
    if (!svg.current) return;
    setFailed(false);
    try {
      download(await pngBlob(svg.current, width, height), `${name}.png`);
    } catch {
      setFailed(true);
    }
  }

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Badge variant="secondary" className="gap-1">
          <Icon className="size-3.5" aria-hidden />
          {kind}
        </Badge>
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h3>
        <ProviderBadge provider={meta.provider} />
      </header>
      {/* The whole drawing, fitted to the card (never blown up past its own size); a click opens it large. */}
      <button type="button" onClick={() => setOpen(true)} aria-label={`Open the ${kind.toLowerCase()} at full size`} className="block max-h-[70dvh] w-full cursor-zoom-in overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" style={{ background: PAPER }}>
        <div style={{ width: "100%", maxWidth: width, margin: "0 auto" }}>{children(svg)}</div>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[92dvh] w-[96vw] max-w-[96vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[96vw]">
          <div className="border-b border-border px-4 py-3 pr-12">
            <DialogTitle className="truncate text-sm font-semibold">{title}</DialogTitle>
            <DialogDescription className="text-xs">{kind} at full size. Scroll or drag the scrollbars to see all of it.</DialogDescription>
          </div>
          <div ref={centre} className="min-h-0 flex-1 overflow-auto" style={{ background: PAPER }} tabIndex={0}>
            {/* A small drawing sits in the middle of the dialog; a large one scrolls. */}
            <div className="grid min-h-full place-items-center" style={{ minWidth: width }}>
              <div style={{ width }}>{children(big)}</div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <footer className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void savePng()}>
          <Download aria-hidden />
          Save picture
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => svg.current && download(svgBlob(svg.current), `${name}.svg`)}>
          Save SVG
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
          <Maximize2 aria-hidden />
          Open
        </Button>
        {failed && (
          <p role="alert" className="text-xs text-destructive">
            This browser could not make the picture. Save the SVG instead.
          </p>
        )}
        <p className="w-full text-xs text-muted-foreground">{SOURCES_NOTE}</p>
      </footer>
    </article>
  );
}

/** Lines of text centred on (x, y). */
function Lines({ lines, x, y, size, lh, fill, weight = 500, anchor = "middle" }: {
  lines: string[]; x: number; y: number; size: number; lh: number; fill: string; weight?: number; anchor?: "start" | "middle" | "end";
}) {
  return (
    <text x={x} y={y - ((lines.length - 1) * lh) / 2} fontSize={size} fontWeight={weight} fill={fill} textAnchor={anchor} dominantBaseline="central" fontFamily={FONT}>
      {lines.map((l, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : lh}>
          {l}
        </tspan>
      ))}
    </text>
  );
}

const MAP_TEXT = [
  { size: 15, lh: 19, weight: 700 },
  { size: 13, lh: 17, weight: 650 },
  { size: 12, lh: 15, weight: 500 },
  { size: 11.5, lh: 15, weight: 450 },
] as const;

function MapBox({ n }: { n: MapNode }) {
  const hue = HUES[n.hue % HUES.length];
  const t = MAP_TEXT[n.level];
  const left = n.x - n.w / 2;
  const top = n.y - n.h / 2;
  if (n.level === 3) {
    // A leaf is text on a short rule in its branch's colour.
    const edge = n.side === 1 ? left : left + n.w;
    return (
      <g>
        <line x1={left} x2={left + n.w} y1={top + n.h} y2={top + n.h} stroke={hue} strokeOpacity={0.45} strokeWidth={1.5} />
        <Lines lines={n.lines} x={edge + n.side * 4} y={n.y} size={t.size} lh={t.lh} fill={MUTED} weight={t.weight} anchor={n.side === 1 ? "start" : "end"} />
      </g>
    );
  }
  const fill = n.level === 0 ? INK : n.level === 1 ? hue : "#FFFFFF";
  return (
    <g>
      <rect x={left} y={top} width={n.w} height={n.h} rx={n.level === 2 ? 9 : n.h / 2} fill={fill} stroke={n.level === 2 ? hue : "none"} strokeWidth={1.5} />
      <Lines lines={n.lines} x={n.x} y={n.y} size={t.size} lh={t.lh} fill={n.level === 2 ? INK : "#FFFFFF"} weight={t.weight} />
    </g>
  );
}

export function MindMapCard({ result }: { result: MindMapResult }) {
  const { nodes, links, width, height } = mindMapLayout(result.mindmap);
  const at = new Map(nodes.map((n) => [n.id, n]));
  return (
    <Frame kind="Mind map" Icon={Network} title={result.mindmap.title} meta={result} width={width} height={height}>
      {(ref) => (
        <svg ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={`Mind map of ${result.mindmap.title}`} style={{ display: "block" }}>
          <rect width={width} height={height} fill={PAPER} />
          {links.map((l) => {
            const a = at.get(l.from) as MapNode;
            const b = at.get(l.to) as MapNode;
            // From the parent's outer edge to the child's inner edge, leaving and arriving level.
            const x1 = a.x + (b.side * a.w) / 2;
            const x2 = b.x - (b.side * b.w) / 2;
            const y2 = b.level === 3 ? b.y + b.h / 2 : b.y;
            const mid = (x1 + x2) / 2;
            return <path key={l.to} d={`M ${x1} ${a.y} C ${mid} ${a.y}, ${mid} ${y2}, ${x2} ${y2}`} fill="none" stroke={HUES[l.hue % HUES.length]} strokeWidth={b.level === 1 ? 3 : b.level === 2 ? 2 : 1.5} strokeOpacity={b.level === 3 ? 0.45 : 0.8} strokeLinecap="round" />;
          })}
          {nodes.map((n) => (
            <MapBox key={n.id} n={n} />
          ))}
        </svg>
      )}
    </Frame>
  );
}

const FLOW_LOOK: Record<FlowBox["kind"], { fill: string; stroke: string; text: string }> = {
  start: { fill: INK, stroke: INK, text: "#FFFFFF" },
  step: { fill: "#FFFFFF", stroke: "#B9BECB", text: INK },
  decision: { fill: "#FEF3C7", stroke: "#D97706", text: INK },
  end: { fill: "#059669", stroke: "#059669", text: "#FFFFFF" },
};
const ARROW = "#5B6170";
/** How far a decision's side points stick in from its box (px). */
const POINT = 16;

function FlowShape({ b }: { b: FlowBox }) {
  const look = FLOW_LOOK[b.kind];
  const l = b.x - b.w / 2;
  const r = b.x + b.w / 2;
  const t = b.y - b.h / 2;
  const bt = b.y + b.h / 2;
  return (
    <g>
      {b.kind === "decision" ? (
        // A question is a six-sided box: its points say "more than one way on".
        <polygon points={`${l + POINT},${t} ${r - POINT},${t} ${r},${b.y} ${r - POINT},${bt} ${l + POINT},${bt} ${l},${b.y}`} fill={look.fill} stroke={look.stroke} strokeWidth={1.5} strokeLinejoin="round" />
      ) : (
        <rect x={l} y={t} width={b.w} height={b.h} rx={b.kind === "step" ? 10 : b.h / 2} fill={look.fill} stroke={look.stroke} strokeWidth={1.5} />
      )}
      <Lines lines={b.lines} x={b.x} y={b.y} size={12.5} lh={16} fill={look.text} weight={b.kind === "step" ? 500 : 650} />
    </g>
  );
}

export function DiagramCard({ result }: { result: DiagramResult }) {
  const { boxes, edges, width, height } = flowLayout(result.flow);
  const at = new Map(boxes.map((b) => [b.id, b]));
  const laneX = width - 18;
  // Several flowcharts can share a page: each needs its own arrowhead id.
  const arrow = `flow-arrow-${useId().replace(/[^a-z0-9]/gi, "")}`;
  return (
    <Frame kind="Flowchart" Icon={GitFork} title={result.flow.title} meta={result} width={width} height={height}>
      {(ref) => (
        <svg ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={`Flowchart of ${result.flow.title}`} style={{ display: "block" }}>
          <defs>
            <marker id={arrow} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={ARROW} />
            </marker>
          </defs>
          <rect width={width} height={height} fill={PAPER} />
          {edges.map((e) => {
            const a = at.get(e.from) as FlowBox;
            const b = at.get(e.to) as FlowBox;
            // Down the chart: bottom of one box to the top of the next. Back up it: out to the lane on the right and in again.
            const d = e.back
              ? `M ${a.x + a.w / 2} ${a.y} C ${laneX} ${a.y}, ${laneX} ${b.y}, ${b.x + b.w / 2 + 2} ${b.y}`
              : `M ${a.x} ${a.y + a.h / 2} C ${a.x} ${(a.y + a.h / 2 + b.y - b.h / 2) / 2}, ${b.x} ${(a.y + a.h / 2 + b.y - b.h / 2) / 2}, ${b.x} ${b.y - b.h / 2 - 2}`;
            const lx = e.back ? laneX - 6 : (a.x + b.x) / 2;
            const ly = e.back ? (a.y + b.y) / 2 : (a.y + a.h / 2 + b.y - b.h / 2) / 2;
            return (
              <g key={`${e.from}>${e.to}`}>
                <path d={d} fill="none" stroke={ARROW} strokeWidth={1.6} strokeDasharray={e.back ? "5 4" : undefined} markerEnd={`url(#${arrow})`} />
                {e.label && (
                  // A halo in the paper's colour keeps the label readable where it crosses its arrow.
                  <text x={lx} y={ly} fontSize={11.5} fontWeight={650} fill={INK} textAnchor={e.back ? "end" : "middle"} dominantBaseline="central" fontFamily={FONT} stroke={PAPER} strokeWidth={5} paintOrder="stroke" strokeLinejoin="round">
                    {e.label}
                  </text>
                )}
              </g>
            );
          })}
          {boxes.map((b) => (
            <FlowShape key={b.id} b={b} />
          ))}
        </svg>
      )}
    </Frame>
  );
}

const PICTURE_NOTE = "AI-made picture. It can show things wrongly or misspell labels: check it before you use it in class.";

export function ImageCard({ result }: { result: ImageResult }) {
  const { base64, mediaType } = result.image;
  const src = `data:${mediaType};base64,${base64}`;
  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Badge variant="secondary" className="gap-1">
          <ImageIcon className="size-3.5" aria-hidden />
          Picture
        </Badge>
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{result.prompt}</h3>
        <ProviderBadge provider={result.provider} />
      </header>
      {/* eslint-disable-next-line @next/next/no-img-element -- bytes from the answer (a data URL), not a file next/image could optimise */}
      <img src={src} alt={`AI-made picture of: ${result.prompt}`} className="mx-auto block max-h-[70dvh] w-full object-contain" style={{ background: PAPER }} />
      <footer className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
        <Button asChild variant="outline" size="sm">
          <a href={src} download={`${fileName(result.prompt)}.${mediaType.split("/")[1]}`}>
            <Download aria-hidden />
            Save picture
          </a>
        </Button>
        <p className="w-full text-xs text-muted-foreground">{PICTURE_NOTE}</p>
      </footer>
    </article>
  );
}
