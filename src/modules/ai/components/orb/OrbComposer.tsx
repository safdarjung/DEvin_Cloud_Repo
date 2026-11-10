"use client";

// Chips (page starters, then every enabled capability) and the one-line input
// with mic and send/stop. Chips send a concrete starter prompt or open the page
// that runs a task.
import Link from "next/link";
import { ArrowUp, ArrowUpRight, Bot, CornerDownRight, MessageSquare, Mic, Sparkles, Square } from "lucide-react";
import type { OrbChip, OrbChipKind } from "./orb-chips";

export interface OrbVoiceUi {
  supported: boolean;
  listening: boolean;
  error: string | null;
  showNote: boolean;
  start: () => void;
  stop: () => void;
}

interface Props {
  chatOn: boolean;
  input: string;
  busy: boolean;
  starters?: string[];
  chips: OrbChip[];
  voice: OrbVoiceUi;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onInput: (v: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
}

const KIND_ICON = { ask: MessageSquare, create: Sparkles, open: ArrowUpRight } as const;
const KIND_LABEL: Record<OrbChipKind, string> = { ask: "Ask", create: "Create", open: "Open" };
const CHIP =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium text-foreground shadow-xs transition-colors hover:border-foreground/30 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
const ROW =
  "flex items-center gap-1.5 overflow-x-auto py-0.5 pl-3 pr-6 [scrollbar-width:none] [mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-24px),transparent)]";

function ChipButton({ chip, busy, onSend }: { chip: OrbChip; busy: boolean; onSend: (t: string) => void }) {
  const Icon = KIND_ICON[chip.kind];
  if (chip.kind === "open" && chip.href) {
    return (
      <Link href={chip.href} className={CHIP} title={`Opens the page that runs ${chip.label}`}>
        {chip.label}
        <Icon className="size-3.5 text-muted-foreground" aria-hidden />
      </Link>
    );
  }
  return (
    <button type="button" disabled={busy} onClick={() => chip.prompt && onSend(chip.prompt)} className={CHIP} title={chip.prompt}>
      <Icon className="size-3.5 text-muted-foreground" aria-hidden />
      {chip.label}
    </button>
  );
}

export function OrbComposer({ chatOn, input, busy, starters, chips, voice, inputRef, onInput, onSend, onStop }: Props) {
  const kinds = (["ask", "create", "open"] as const).filter((k) => chips.some((c) => c.kind === k));
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-2">
      {chatOn && starters && starters.length > 0 && (
        <div className={ROW} role="group" aria-label="From the page you were on">
          <span className="flex shrink-0 items-center gap-1 pr-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <CornerDownRight className="size-3.5" aria-hidden />
            From the page you were on
          </span>
          {starters.map((s) => (
            <button key={s} type="button" disabled={busy} onClick={() => onSend(s)} className={`${CHIP} border-foreground/20 bg-accent`}>
              {s}
            </button>
          ))}
        </div>
      )}
      {kinds.length > 0 && (
        <div className={ROW} role="group" aria-label="AI capabilities">
          {kinds.map((k, gi) => (
            <div key={k} className="flex shrink-0 items-center gap-1.5">
              <span className={`shrink-0 pr-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground ${gi > 0 ? "border-l border-border pl-2.5" : ""}`}>
                {KIND_LABEL[k]}
              </span>
              {chips.filter((c) => c.kind === k).map((c) => <ChipButton key={c.key} chip={c} busy={busy} onSend={onSend} />)}
            </div>
          ))}
        </div>
      )}
      {chatOn ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSend(input);
          }}
          className="flex items-center gap-1 rounded-full border border-border bg-card p-1.5 shadow-[0_16px_40px_-20px_rgb(0_0_0/0.35)] transition-[border-color,box-shadow] focus-within:border-foreground/40 focus-within:ring-4 focus-within:ring-ring/10"
        >
          {voice.supported && (
            <button
              type="button"
              onClick={voice.listening ? voice.stop : voice.start}
              disabled={busy}
              aria-pressed={voice.listening}
              aria-label={voice.listening ? "Stop listening and send" : "Speak your question"}
              title={voice.listening ? "Stop and send" : "Speak"}
              className={`relative grid size-10 shrink-0 place-items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:size-9 ${
                voice.listening ? "bg-destructive text-white" : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {voice.listening && <span className="absolute inset-0 animate-ping rounded-full bg-destructive/40 motion-reduce:hidden" aria-hidden />}
              {voice.listening ? <Square className="relative size-3.5 fill-current" aria-hidden /> : <Mic className="size-[18px]" aria-hidden />}
            </button>
          )}
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => onInput(e.target.value)}
            placeholder={voice.listening ? "Listening…" : "Ask anything about your work"}
            readOnly={busy || voice.listening}
            aria-label="Message"
            className="h-10 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground sm:h-9"
          />
          {busy ? (
            <button type="button" onClick={onStop} aria-label="Stop answering" className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-9">
              <Square className="size-3.5 fill-current" aria-hidden />
            </button>
          ) : (
            <button type="submit" disabled={!input.trim() || voice.listening} aria-label="Send" className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30 sm:size-9">
              <ArrowUp className="size-[18px]" aria-hidden />
            </button>
          )}
        </form>
      ) : (
        <p className="mx-auto flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground">
          <Bot className="size-4 shrink-0" aria-hidden />
          AI is off for your role — ask your admin to enable it in AI roles.
        </p>
      )}
      {(voice.showNote || voice.error) && (
        <p role={voice.error ? "alert" : undefined} className={`px-4 text-xs ${voice.error ? "text-destructive" : "text-muted-foreground"}`}>
          {voice.error ?? "Your browser's speech service does the transcription."}
        </p>
      )}
    </div>
  );
}
