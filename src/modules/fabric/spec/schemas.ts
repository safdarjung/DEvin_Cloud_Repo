// F-BE-03 / ADR D36 — Fabric Canvas spec v2. A closed, Zod-validated JSON
// description of a whole canvas: a flat node list (≤24) wired by id, never
// nested, because recursive schemas are fragile across Gemini/Groq/Ollama
// structured output (14-generative-ui-plan.md §4). Node kinds = the 7 D31
// blocks (reused from the block catalog, plus `id`) | layout | widget | flow.
//
// Every string ≤500 (DBT-27 Ollama cap); everything is plain data — no
// markup, no ReactNode, icons by name. Links are internal paths only. The
// model emits actions as data; `canvas-renderer` hands them to the caller
// and never executes them (CLAUDE.md rule 6).
import { z } from "zod";
import {
  CalloutBlockSchema,
  ChartBlockSchema,
  FlashcardsBlockSchema,
  MindmapBlockSchema,
  NotesBlockSchema,
  PracticeBlockSchema,
  TableBlockSchema,
} from "@/modules/ai/blocks/schemas";

export const MAX_CANVAS_NODES = 24;

const str = (max = 500) => z.string().trim().min(1).max(max);
const nodeId = str(64);
// Internal app path only: blocks `javascript:`, `https://…`, and `//host`.
const href = str().regex(/^\/(?!\/)/, "Must be an internal path starting with /.");

export const CANVAS_ICON_NAMES = [
  "users", "user", "graduation-cap", "book-open", "calendar", "clock", "wallet",
  "indian-rupee", "receipt", "clipboard-check", "bell", "triangle-alert", "circle-check",
  "trending-up", "trending-down", "file-text", "settings", "sparkles", "school", "bus",
  "megaphone", "message-square", "chart-column", "plus",
] as const;
const icon = z.enum(CANVAS_ICON_NAMES);

export const CanvasActionSchema = z
  .object({
    type: z.enum(["navigate", "openSheet", "setFilter", "runScenario", "installModule", "approve", "export"]),
    payload: z
      .record(str(64), z.string().trim().max(200))
      .refine((p) => Object.keys(p).length <= 10, "Payload takes at most 10 keys."),
  })
  .strict();
const action = CanvasActionSchema.optional();

// --- widget props: serializable mirrors of src/components/widgets/* ---

const frame = { title: str(), description: str().optional(), icon: icon.optional() };

const KpiProps = z
  .object({
    label: str(),
    value: str(),
    animateTo: z.number().finite().optional(),
    format: z.enum(["number", "inr", "percent"]).optional(),
    sub: str().optional(),
    href: href.optional(),
    delta: z.object({ value: z.number().finite(), label: str(), positiveIsGood: z.boolean().optional() }).strict().optional(),
    action,
  })
  .strict();

const TrendProps = z
  .object({
    ...frame,
    data: z.array(z.object({ label: str(), value: z.number().finite() }).strict()).max(60),
    unit: z.enum(["percent", "inr", "count"]),
    target: z.number().finite().optional(),
  })
  .strict();

const ListProps = z
  .object({
    ...frame,
    emptyTitle: str().optional(),
    rows: z
      .array(
        z
          .object({
            id: nodeId,
            title: str(),
            meta: str().optional(),
            href: href.optional(),
            badge: z
              .object({ label: str(), variant: z.enum(["default", "secondary", "destructive", "success", "warning", "info", "outline", "ghost", "link"]) })
              .strict()
              .optional(),
            action,
          })
          .strict(),
      )
      .max(20),
  })
  .strict();

const TimelineProps = z
  .object({
    ...frame,
    events: z.array(z.object({ id: nodeId, title: str(), time: z.iso.datetime({ offset: true }), meta: str().optional() }).strict()).max(20),
  })
  .strict();

const ApprovalsProps = z
  .object({
    ...frame,
    rows: z
      .array(z.object({ id: nodeId, kind: str(40), title: str(), requestedBy: str(), age: str(40), href: href.optional() }).strict())
      .max(20),
  })
  .strict();

const count = z.number().int().min(0).max(100_000);
const StaffAvailabilityProps = z
  .object({
    ...frame,
    present: count,
    onLeave: count,
    absent: count,
    onLeaveStaff: z.array(z.object({ name: str(), role: str(), until: str(40) }).strict()).max(20),
  })
  .strict();

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24h).");
const TimetableProps = z
  .object({
    ...frame,
    periods: z
      .array(
        z
          .object({
            start: hhmm,
            end: hhmm,
            title: str(),
            subtitle: str().optional(),
            room: str().optional(),
            isCurrent: z.boolean().optional(),
            isNext: z.boolean().optional(),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();

const AiInsightProps = z
  .object({
    title: str(),
    detected: str(),
    whyItMatters: str(),
    evidence: z.array(str()).max(8),
    suggestedAction: z.object({ label: str(), href: href.optional() }).strict(),
    requiresApproval: z.boolean().optional(),
    confidence: z.enum(["low", "medium", "high"]).optional(),
  })
  .strict();

const QuickActionsProps = z
  .object({
    title: str().optional(),
    description: str().optional(),
    actions: z.array(z.object({ href, label: str(), icon }).strict()).min(1).max(8),
  })
  .strict();

const widget = <N extends string, P extends z.ZodType>(name: N, props: P) =>
  z.object({ id: nodeId, kind: z.literal("widget"), name: z.literal(name), props }).strict();

const WidgetNodeSchema = z.discriminatedUnion("name", [
  widget("kpi", KpiProps),
  widget("trend", TrendProps),
  widget("list", ListProps),
  widget("timeline", TimelineProps),
  widget("approvals", ApprovalsProps),
  widget("staffAvailability", StaffAvailabilityProps),
  widget("timetable", TimetableProps),
  widget("aiInsight", AiInsightProps),
  widget("quickActions", QuickActionsProps),
]);

const LayoutNodeSchema = z
  .object({
    id: nodeId,
    kind: z.literal("layout"),
    variant: z.enum(["grid", "stack", "tabs", "split"]),
    children: z.array(nodeId).min(1).max(12),
    cols: z.number().int().min(1).max(4).optional(),
    tabTitles: z.array(str(80)).max(12).optional(),
  })
  .strict();

// shortcut: edge source/target are not checked against node ids here, F-BE-20 (FlowCanvas) decides drop vs reject.
const FlowNodeSchema = z
  .object({
    id: nodeId,
    kind: z.literal("flow"),
    nodes: z
      .array(
        z
          .object({ id: nodeId, label: str(), type: str(40), x: z.number().finite().optional(), y: z.number().finite().optional() })
          .strict(),
      )
      .min(1)
      .max(80),
    edges: z.array(z.object({ source: nodeId, target: nodeId, label: str().optional() }).strict()).max(160),
  })
  .strict();

// The D31 blocks, reused as-is plus `id`. safeExtend keeps their refinements.
const withId = { id: nodeId };
const BLOCK_NODES = [
  NotesBlockSchema.safeExtend(withId),
  TableBlockSchema.safeExtend(withId),
  FlashcardsBlockSchema.safeExtend(withId),
  PracticeBlockSchema.safeExtend(withId),
  CalloutBlockSchema.safeExtend({ ...withId, action }),
  MindmapBlockSchema.safeExtend(withId),
  ChartBlockSchema.safeExtend(withId),
] as const;
const BLOCK_KINDS = new Set<string>(BLOCK_NODES.map((s) => s.shape.kind.value));

export const CanvasNodeSchema = z.discriminatedUnion("kind", [
  ...BLOCK_NODES,
  LayoutNodeSchema,
  WidgetNodeSchema,
  FlowNodeSchema,
]);

export const CanvasSpecSchema = z
  .object({
    version: z.literal(1),
    root: nodeId,
    nodes: z.array(CanvasNodeSchema).min(1).max(MAX_CANVAS_NODES),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message, path: ["nodes"] });
    const byId = new Map<string, CanvasNode>();
    for (const node of spec.nodes) {
      if (byId.has(node.id)) return issue(`Duplicate node id "${node.id}".`);
      byId.set(node.id, node);
    }

    const root = byId.get(spec.root);
    if (!root) return ctx.addIssue({ code: "custom", message: `Root "${spec.root}" does not resolve.`, path: ["root"] });
    if (root.kind !== "layout" && !BLOCK_KINDS.has(root.kind)) {
      return ctx.addIssue({ code: "custom", message: "Root must be a layout or a single block.", path: ["root"] });
    }

    for (const node of spec.nodes) {
      if (node.kind !== "layout") continue;
      const missing = node.children.find((child) => !byId.has(child));
      if (missing) return issue(`Layout "${node.id}" child "${missing}" does not resolve.`);
    }

    // DFS over layout children: a node revisited while still on the stack is a cycle.
    const state = new Map<string, "open" | "done">();
    const visit = (id: string): boolean => {
      if (state.get(id) === "open") return false;
      if (state.get(id) === "done") return true;
      state.set(id, "open");
      const node = byId.get(id);
      const ok = node?.kind !== "layout" || node.children.every(visit);
      state.set(id, "done");
      return ok;
    };
    if (!spec.nodes.every((node) => visit(node.id))) issue("Layout children form a cycle.");
  });

export type CanvasSpec = z.infer<typeof CanvasSpecSchema>;
export type CanvasNode = z.infer<typeof CanvasNodeSchema>;
export type CanvasAction = z.infer<typeof CanvasActionSchema>;
export type CanvasIconName = (typeof CANVAS_ICON_NAMES)[number];
export type WidgetNode = z.infer<typeof WidgetNodeSchema>;
export type LayoutNode = z.infer<typeof LayoutNodeSchema>;
