"use client";

// Page starters (from the page you were on) and the one-line input with mic and
// send/stop. Typing "/" lists the orb's commands (a combobox: arrows, Enter/Tab to
// pick, Esc to hide); next to the mic sit the voice language and the "Read answers
// aloud" switch. Section prompts and AI tools live in OrbGroups.
import { useId, useState } from "react";
import { ArrowUp, Bot, CornerDownRight, Mic, Square, Volume2 } from "lucide-react";
import { ORB_COMMANDS } from "@/modules/ai/explain/commands";
import { VOICE_LANGS, type VoiceLang } from "./useVoice";

export interface OrbVoiceUi {
  supported: boolean;
  listening: boolean;
  error: string | null;
  showNote: boolean;
  lang: VoiceLang;
  setLang: (l: VoiceLang) => void;
  start: () => void;
  stop: () => void;
}

export interface OrbReadAloudUi {
  supported: boolean;
  readAloud: boolean;
  setReadAloud: (on: boolean) => void;
}

interface Props {
  chatOn: boolean;
  input: string;
  busy: boolean;
  starters?: string[];
  voice: OrbVoiceUi;
  speech: OrbReadAloudUi;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onInput: (v: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
}

const CHIP =
  "inline-flex min-h-11 shrink-0 py-1 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium text-foreground shadow-xs transition-colors hover:border-foreground/30 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
const ROW =
  "flex items-center gap-1.5 overflow-x-auto py-0.5 pl-3 pr-6 [scrollbar-width:none] [mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-24px),transparent)]";
const VOICE_NOTE = "Your browser's speech service turns your voice into text (Chrome: Google, Edge: Microsoft, Safari: Apple).";

export function OrbComposer({ chatOn, input, busy, starters, voice, speech, inputRef, onInput, onSend, onStop }: Props) {
  const listId = useId();
  const [cursor, setCursor] = useState(0);
  // The input value at which Esc hid the list (typing on shows it again).
  const [hiddenAt, setHiddenAt] = useState<string | null>(null);
  const slash = /^\/\S*$/.test(input) ? input.slice(1).toLowerCase() : null;
  const hits = slash === null ? [] : ORB_COMMANDS.filter((c) => c.name.startsWith(slash));
  const listOpen = hits.length > 0 && hiddenAt !== input;
  const at = Math.min(cursor, hits.length - 1);
  const pick = (name: string) => {
    onInput(`/${name} `);
    setCursor(0);
  };

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!listOpen) return;
    if (e.key === "ArrowDown") setCursor((at + 1) % hits.length);
    else if (e.key === "ArrowUp") setCursor((at - 1 + hits.length) % hits.length);
    else if (e.key === "Enter" || e.key === "Tab") pick(hits[at].name);
    else if (e.key === "Escape") setHiddenAt(input);
    else return;
    e.preventDefault();
  }

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
      {chatOn ? (
        <div className="relative">
          {listOpen && (
            <ul
              id={listId}
              role="listbox"
              aria-label="Orb commands"
              className="absolute inset-x-2 bottom-full mb-2 space-y-0.5 rounded-2xl border border-border bg-popover p-1 text-popover-foreground shadow-lg"
            >
              {hits.map((c, i) => (
                <li
                  key={c.name}
                  id={`${listId}-${c.name}`}
                  role="option"
                  aria-selected={i === at}
                  // Keep focus in the input.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(c.name)}
                  onPointerMove={() => setCursor(i)}
                  className={`flex min-h-11 cursor-pointer flex-col justify-center rounded-xl px-3 py-1.5 text-sm ${i === at ? "bg-accent outline outline-2 -outline-offset-2 outline-foreground" : ""}`}
                >
                  <span className="font-medium">{c.usage}</span>
                  <span className="text-xs text-muted-foreground">{c.help}</span>
                </li>
              ))}
            </ul>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSend(input);
            }}
            className="flex items-center gap-1 rounded-full border border-border bg-card p-1.5 shadow-[0_16px_40px_-20px_rgb(0_0_0/0.35)] transition-[border-color,box-shadow] focus-within:border-foreground/40 focus-within:ring-4 focus-within:ring-ring/10"
          >
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
            <select
              value={voice.lang}
              onChange={(e) => voice.setLang(e.target.value as VoiceLang)}
              aria-label="Voice input language"
              title="Voice input language"
              className="h-10 shrink-0 cursor-pointer rounded-full bg-transparent px-1.5 text-xs font-medium text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:h-9"
            >
              {VOICE_LANGS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.short}
                </option>
              ))}
            </select>
            {speech.supported && (
              <button
                type="button"
                aria-pressed={speech.readAloud}
                aria-label="Read answers aloud"
                title={speech.readAloud ? "Reading answers aloud: on" : "Read answers aloud"}
                onClick={() => speech.setReadAloud(!speech.readAloud)}
                className={`grid size-10 shrink-0 place-items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-9 ${
                  speech.readAloud ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <Volume2 className="size-[18px]" aria-hidden />
              </button>
            )}
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => {
                onInput(e.target.value);
                setCursor(0);
              }}
              onKeyDown={onKeyDown}
              role="combobox"
              aria-expanded={listOpen}
              aria-controls={listOpen ? listId : undefined}
              aria-autocomplete="list"
              aria-activedescendant={listOpen ? `${listId}-${hits[at].name}` : undefined}
              placeholder={voice.listening ? "Listening…" : "Ask anything, or type / for commands"}
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
        </div>
      ) : (
        <p className="mx-auto flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground">
          <Bot className="size-4 shrink-0" aria-hidden />
          AI is off for your role — ask your admin to enable it in AI roles.
        </p>
      )}
      {(voice.showNote || voice.error) && (
        <p role={voice.error ? "alert" : undefined} className={`px-4 text-xs ${voice.error ? "text-destructive" : "text-muted-foreground"}`}>
          {voice.error ?? VOICE_NOTE}
        </p>
      )}
    </div>
  );
}
