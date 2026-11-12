"use client";

// The orb's conversation panel: streaming transcript, approval cards (a human
// approves; the AI never writes), draft cards, provider badge (rule 7), and a clear
// error. Task cards come only from a tool OUTPUT of kind "task_proposal" (never the
// tool-call input); one answer's cards share a stack, and cards opened from a feature
// click sit in the timeline where they were opened. The view follows new text only
// while the reader is at the bottom; scrolled up, a "Latest" button brings them back.
import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { isToolUIPart, type UIMessage } from "ai";
import { ArrowDown, Check, ChevronDown, Copy, RefreshCw, RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionDraftCard, isDraftToolPartType, parseDraftToolOutput } from "@/modules/ai/components/ActionDraftCard";
import { ProviderBadge } from "@/modules/ai/components/ProviderBadge";
import { FileAnswerCard, type FileAnswerResult } from "./OrbFile";
import TaskStack from "@/modules/ai/components/task-card/TaskStack";
import { taskProposalFromPart } from "@/modules/ai/components/task-card/parse";
import type { TaskCardProps } from "@/modules/ai/components/task-card/TaskCard";
import { AnatomyCard, type AnatomyResult } from "@/modules/ai/components/explain/AnatomyCard";
import { InfographicCard, type InfographicResult } from "@/modules/ai/components/explain/InfographicCard";
import { DiagramCard, ImageCard, MindMapCard, type DiagramResult, type ImageResult, type MindMapResult } from "@/modules/ai/components/explain/VisualCards";
import { SpeakButton } from "@/modules/ai/components/voice/SpeakButton";
import { navigateLink, plainChatText, readToolLabel, sourceLabel } from "@/modules/ai/chat-text";
import type { ExplainDepth, ExplainMode } from "@/modules/ai/explain/schemas";
import type { TaskProposalOutput } from "@/modules/ai/tasks/types";

export type OrbMessage = UIMessage<{ provider?: "local" | "cloud"; sources?: Array<{ query: string }> }>;

// Teacher quiz / remark drafts have their own review editors on the AI page.
const EDITOR_DRAFT_TOOLS = new Set(["tool-generateQuiz", "tool-draftResultRemark"]);

/** "tool-getAttendanceSummary" -> "get attendance summary". */
const toolName = (type: string) => type.replace(/^tool-/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();

type Part = OrbMessage["parts"][number];

/** Proposals in one message, read from finished tool OUTPUTS only. */
export function proposalsIn(parts: readonly Part[]): TaskProposalOutput[] {
  return parts.flatMap((p) => {
    if (!isToolUIPart(p) || p.state !== "output-available") return [];
    const proposal = taskProposalFromPart(p);
    return proposal ? [proposal] : [];
  });
}

/** A card opened from a feature click (no model call): shown after the first `at` messages. */
export interface LocalCard {
  proposal: TaskProposalOutput;
  at: number;
}

/** A slash command's run (/anatomy, /teardown, /infographic, /mindmap, /diagram, /image): its own entry, shown after the first `at` messages. */
export interface ExplainEntry {
  id: string;
  at: number;
  /** What the person typed, e.g. "/anatomy human heart". */
  line: string;
  subject: string;
  mode: ExplainMode;
  pending: boolean;
  anatomy?: AnatomyResult;
  poster?: InfographicResult;
  mindmap?: MindMapResult;
  diagram?: DiagramResult;
  image?: ImageResult;
  file?: FileAnswerResult;
  /** Made from an uploaded file: the follow-on buttons would lose the file, so they are not offered. */
  fromFile?: boolean;
  /** A depth change or a poster is being made. */
  busy?: boolean;
  /** The envelope's message (or the refusal reason): never blank. */
  error?: string;
}

export interface ExplainHandlers {
  onDepth: (id: string, depth: ExplainDepth) => void;
  onPoster: (id: string) => void;
  onAskFile: (question: string) => void;
  /** "Also make": the same topic as another kind of result. */
  onNext: (id: string, kind: NextKind) => void;
}

export type NextKind = "anatomy" | "mindmap" | "diagram";
const NEXT: { kind: NextKind; label: string }[] = [
  { kind: "anatomy", label: "Explain the parts" },
  { kind: "mindmap", label: "Draw a mind map" },
  { kind: "diagram", label: "Draw a flowchart" },
];

function Dots({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-1 text-muted-foreground" aria-label={label}>
      {[0, 150, 300].map((d) => (
        <span key={d} className="size-1.5 animate-bounce rounded-full bg-current" style={{ animationDelay: `${d}ms` }} aria-hidden />
      ))}
    </p>
  );
}

function Explain({ e, handlers }: { e: ExplainEntry; handlers: ExplainHandlers }) {
  return (
    <div className="space-y-2">
      <p className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3 py-2 text-primary-foreground">{e.line}</p>
      {e.pending && <Dots label="Working on it" />}
      {e.anatomy && (
        <AnatomyCard
          result={e.anatomy}
          busy={e.busy}
          onDepthChange={(d) => handlers.onDepth(e.id, d)}
          onMakeInfographic={e.poster ? undefined : () => handlers.onPoster(e.id)}
        />
      )}
      {e.busy && <Dots label="Working on it" />}
      {e.poster && <InfographicCard result={e.poster} variant="poster" />}
      {e.mindmap && <MindMapCard result={e.mindmap} fromFile={e.fromFile} />}
      {e.diagram && <DiagramCard result={e.diagram} fromFile={e.fromFile} />}
      {e.image && <ImageCard result={e.image} />}
      {!e.pending && !e.busy && !e.fromFile && (e.anatomy || e.mindmap || e.diagram) && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Also make">
          <span className="text-xs text-muted-foreground">Also:</span>
          {NEXT.filter((n) => !(n.kind === "anatomy" && e.anatomy) && !(n.kind === "mindmap" && e.mindmap) && !(n.kind === "diagram" && e.diagram)).map((n) => (
            <Button key={n.kind} type="button" size="sm" variant="outline" className="min-h-9 rounded-full text-xs" onClick={() => handlers.onNext(e.id, n.kind)}>
              {n.label}
            </Button>
          ))}
        </div>
      )}
      {e.file && <FileAnswerCard result={e.file} onAsk={handlers.onAskFile} disabled={Boolean(e.pending || e.busy)} />}
      {e.error && (
        <p role="alert" className="flex items-start gap-1.5 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {e.error}
        </p>
      )}
    </div>
  );
}

/** Copies an answer; the tick shows for a moment (nothing shows if the browser refuses). */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => {})}
      aria-label={copied ? "Copied" : "Copy this answer"}
      title={copied ? "Copied" : "Copy"}
      className="grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-11"
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
    </button>
  );
}

/** New entries rise into place (transform and opacity only; nothing under reduced motion, which the CSS query handles). */
const RISE = "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300";
/** Within this many px of the bottom the view keeps following new text. */
const STICK_PX = 72;

type CardHandlers = Pick<TaskCardProps, "onResolved" | "onStart">;

/** The jump target for the "Waiting for you" tray: `[data-proposals~="<id>"]`. */
function Cards({ proposals, institutionSlug, handlers }: { proposals: TaskProposalOutput[]; institutionSlug: string; handlers: CardHandlers }) {
  if (proposals.length === 0) return null;
  return (
    <div data-proposals={proposals.map((p) => p.proposalId).join(" ")} tabIndex={-1} className="rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <TaskStack proposals={proposals} institutionSlug={institutionSlug} onResolved={handlers.onResolved} onStart={handlers.onStart} />
    </div>
  );
}

function ToolPart({ part, institutionSlug }: { part: Part; institutionSlug: string }) {
  if (!isToolUIPart(part)) return null;
  if (part.state === "output-available" && taskProposalFromPart(part)) return null; // rendered by <Cards>
  if (part.state !== "output-available") {
    if (part.state === "output-error") return null;
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden />
        {part.type === "tool-propose_task" ? "Preparing a card…" : `Checking ${readToolLabel(part.type.replace(/^tool-/, "")) ?? toolName(part.type)}…`}
      </p>
    );
  }
  const link = navigateLink(part);
  if (link) {
    return (
      <Link href={link.href} className="block text-sm font-medium underline underline-offset-2">
        Open {link.label}
      </Link>
    );
  }
  if (EDITOR_DRAFT_TOOLS.has(part.type)) {
    return (
      <Link href={`/${institutionSlug}/ai`} className="block text-xs font-medium underline underline-offset-2">
        Review this draft in AI Assistant
      </Link>
    );
  }
  if (!isDraftToolPartType(part.type)) return null;
  const parsed = parseDraftToolOutput(part.output);
  if (!parsed) return null;
  if ("error" in parsed) return <p role="alert" className="text-sm text-destructive">{parsed.error}</p>;
  return <ActionDraftCard institutionSlug={institutionSlug} action={parsed.action} input={parsed.input} summary={parsed.summary} />;
}

function Message({ message, institutionSlug, streaming, handlers, onAgain }: {
  message: OrbMessage; institutionSlug: string; streaming: boolean; handlers: CardHandlers;
  /** The newest answer only: ask the same question again. */
  onAgain?: () => void;
}) {
  const text = plainChatText(message.parts.map((p) => (p.type === "text" ? p.text : "")).join(""));
  const tools = message.parts.filter((p) => isToolUIPart(p));
  if (!text && tools.length === 0) return null;
  if (message.role === "user") {
    return <p className={`ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3 py-2 text-primary-foreground ${RISE}`}>{text}</p>;
  }
  const provider = message.metadata?.provider;
  const sources = [...new Set((message.metadata?.sources ?? []).map((s) => sourceLabel(s.query)))];
  return (
    <div className={`min-w-0 max-w-full space-y-2 ${RISE}`}>
      {tools.map((part, i) => <ToolPart key={i} part={part} institutionSlug={institutionSlug} />)}
      <Cards proposals={proposalsIn(message.parts)} institutionSlug={institutionSlug} handlers={handlers} />
      {text && (
        <p className="whitespace-pre-wrap leading-relaxed">
          {text}
          {streaming && <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-foreground" aria-hidden />}
        </p>
      )}
      {sources.length > 0 && <p className="text-xs text-muted-foreground">Records used: {sources.join(" · ")}</p>}
      {(provider || (text && !streaming)) && (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          {provider && <ProviderBadge provider={provider} />}
          {text && !streaming && <SpeakButton text={text} />}
          {text && !streaming && <CopyButton text={text} />}
          {/* Not for an answer that brought cards: asking again would make them twice. */}
          {onAgain && text && !streaming && proposalsIn(message.parts).length === 0 && (
            <button
              type="button"
              onClick={onAgain}
              aria-label="Answer this again"
              title="Answer again"
              className="grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-11"
            >
              <RefreshCw className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface Props extends CardHandlers {
  institutionSlug: string;
  messages: OrbMessage[];
  localCards: readonly LocalCard[];
  explains: readonly ExplainEntry[];
  explainHandlers: ExplainHandlers;
  status: string;
  error: string | null;
  accent: string;
  onRetry: () => void;
  onDismissError: () => void;
  onNewChat: () => void;
  onCollapse: () => void;
}

export function OrbTranscript({
  institutionSlug, messages, localCards, explains, explainHandlers, status, error, accent, onRetry, onDismissError, onNewChat, onCollapse, onResolved, onStart,
}: Props) {
  const handlers: CardHandlers = { onResolved, onStart };
  const localAt = (n: number) => localCards.filter((c) => c.at === n).map((c) => c.proposal);
  const explainsAt = (n: number) => explains.filter((x) => x.at === n).map((x) => <Explain key={x.id} e={x} handlers={explainHandlers} />);
  const scroller = useRef<HTMLDivElement>(null);
  const last = messages.at(-1);
  const answerShown = last?.role === "assistant" && last.parts.some((p) => (p.type === "text" && p.text) || isToolUIPart(p));
  const thinking = status === "submitted" || (status === "streaming" && !answerShown);
  const label = error ? "Error" : thinking ? "Thinking…" : status === "streaming" ? "Answering…" : "Ready";
  const busyNow = status === "submitted" || status === "streaming";

  // Keep the newest text in view while it streams, unless the reader scrolled up to read.
  const stick = useRef(true);
  const [away, setAway] = useState(false);
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, localCards, explains, status, error]);
  // Their own message always brings the view back down.
  const sent = messages.filter((m) => m.role === "user").length + explains.length;
  useEffect(() => {
    stick.current = true;
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [sent]);
  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
    setAway(!stick.current);
  }
  function toLatest() {
    const el = scroller.current;
    if (!el) return;
    stick.current = true;
    setAway(false);
    el.scrollTo({ top: el.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  return (
    <section aria-label="Conversation" className="relative flex size-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card/95 shadow-[0_24px_60px_-30px_rgb(0_0_0/0.35)] backdrop-blur">
      {/* A hairline in the orb's colour: it runs while the orb works. */}
      <span
        aria-hidden
        className={`absolute inset-x-0 top-0 h-0.5 ${busyNow ? "motion-safe:animate-pulse" : ""}`}
        style={{ background: `linear-gradient(90deg, transparent, ${error ? "var(--destructive)" : accent}, transparent)`, opacity: busyNow || error ? 1 : 0.5 }}
      />
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="relative grid size-2 place-items-center" aria-hidden>
          {busyNow && <span className="absolute inset-0 rounded-full motion-safe:animate-ping" style={{ background: accent }} />}
          <span className="relative size-2 rounded-full" style={{ background: error ? "var(--destructive)" : accent }} />
        </span>
        <h2 className="text-sm font-semibold">Conversation</h2>
        <span className="text-xs text-muted-foreground">{label}</span>
        <div className="ml-auto flex items-center gap-0.5">
          <Button type="button" variant="ghost" size="icon-sm" onClick={onNewChat} aria-label="Start a new conversation" title="New conversation">
            <RotateCcw />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onCollapse} aria-label="Hide conversation" title="Hide">
            <ChevronDown />
          </Button>
        </div>
      </header>
      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-3 text-sm" aria-live="polite">
        {localAt(0).map((p) => (
          <Cards key={p.proposalId} proposals={[p]} institutionSlug={institutionSlug} handlers={handlers} />
        ))}
        {explainsAt(0)}
        {messages.map((m, i) => (
          <Fragment key={m.id}>
            <Message
              message={m}
              institutionSlug={institutionSlug}
              streaming={status === "streaming" && m === last}
              handlers={handlers}
              onAgain={m === last && m.role === "assistant" && status === "ready" && !error ? onRetry : undefined}
            />
            {localAt(i + 1).map((p) => (
              <Cards key={p.proposalId} proposals={[p]} institutionSlug={institutionSlug} handlers={handlers} />
            ))}
            {explainsAt(i + 1)}
          </Fragment>
        ))}
        {thinking && (
          <p className={`flex items-center gap-2 text-muted-foreground ${RISE}`}>
            <span className="relative grid size-3 place-items-center" aria-hidden>
              <span className="absolute inset-0 rounded-full motion-safe:animate-ping" style={{ background: accent, opacity: 0.6 }} />
              <span className="relative size-2 rounded-full" style={{ background: accent }} />
            </span>
            Thinking…
          </p>
        )}
        {error && (
          <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
            <p className="flex items-center gap-1.5 font-medium text-destructive">
              <TriangleAlert className="size-4" aria-hidden />
              Couldn&apos;t get an answer
            </p>
            <p className="mt-1 text-muted-foreground">{error}</p>
            <div className="mt-2 flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={onRetry}>Try again</Button>
              <Button type="button" size="sm" variant="ghost" onClick={onDismissError}>Dismiss</Button>
            </div>
          </div>
        )}
      </div>
      {away && (
        <motion.button
          type="button"
          onClick={toLatest}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="absolute bottom-3 left-1/2 inline-flex min-h-9 -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium shadow-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
        >
          <ArrowDown className="size-3.5" aria-hidden />
          Latest
        </motion.button>
      )}
    </section>
  );
}
