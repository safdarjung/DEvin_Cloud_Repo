"use client";

// App Orb: only a sphere of the person's apps, a one-line chat input (typed or
// spoken) and capability chips. Chat runs over the existing per-role endpoint.
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRef, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { MessagesSquare } from "lucide-react";
import type { Role } from "@/lib/auth/permissions";
import { chatErrorMessage } from "@/modules/ai/chat-error";
import { OrbComposer } from "./OrbComposer";
import { OrbTranscript, type OrbMessage } from "./OrbTranscript";
import type { OrbChip } from "./orb-chips";
import { ORB_ICONS } from "./orb-icons";
import { orbState, type OrbState } from "./orb-layout";
import { ROLE_ACCENTS, groupHue } from "./orb-theme";
import type { OrbApp, OrbSignals } from "./OrbScene";
import { useVoice } from "./useVoice";

const OrbScene = dynamic(() => import("./OrbScene"), {
  ssr: false,
  loading: () => <div className="mx-auto mt-[12%] size-48 animate-pulse rounded-full bg-muted" />,
});

export interface OrbChat {
  /** One of the existing role routes under /api/ai/agent. */
  endpoint: string;
  /** Guardians only: the selected child. */
  studentId?: string;
}

interface Props {
  institutionSlug: string;
  role: Role;
  apps: OrbApp[];
  chat: OrbChat | null;
  chips: OrbChip[];
  /** Page-aware questions from the page the person came from (`?from=`). */
  starters?: string[];
}

const noSubscribe = () => () => {};
const REDUCED = "(prefers-reduced-motion: reduce)";
const subscribeReduced = (cb: () => void) => {
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
// Probed once: getSnapshot runs on every render, and each probe would open a
// new WebGL context until the browser drops the orb's own.
let webgl: boolean | undefined;
function canRender3d(): boolean {
  if (webgl !== undefined) return webgl;
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") ?? c.getContext("webgl");
    webgl = Boolean(gl);
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webgl = false;
  }
  return webgl;
}

const STATE_LABEL: Record<OrbState, string> = {
  idle: "Ready", listening: "Listening", typing: "Ready", submitted: "Thinking", streaming: "Answering", error: "Error",
};

function AppGrid({ apps }: { apps: OrbApp[] }) {
  const groups = [...new Set(apps.map((a) => a.group))];
  return (
    <nav aria-label="Apps" className="h-full space-y-5 overflow-y-auto pb-4">
      {groups.map((g) => (
        <section key={g}>
          <h2 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span className="size-2 rounded-full" style={{ background: groupHue(g) }} aria-hidden />
            {g}
          </h2>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {apps.filter((a) => a.group === g).map((app) => {
              const Icon = ORB_ICONS[app.icon];
              return (
                <li key={app.href}>
                  <Link href={app.href} className="flex items-center gap-2 rounded-xl border border-border bg-card p-3 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <Icon className="size-4" style={{ color: groupHue(g) }} aria-hidden />
                    {app.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}

export function OrbView({ institutionSlug, role, apps, chat, chips, starters }: Props) {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(true);
  const use3d = useSyncExternalStore(noSubscribe, canRender3d, () => false);
  const reduced = useSyncExternalStore(subscribeReduced, () => window.matchMedia(REDUCED).matches, () => false);
  const dark = useTheme().resolvedTheme === "dark";
  const accent = ROLE_ACCENTS[role];
  const signals = useRef<OrbSignals>({ level: 0, pulse: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const { messages, sendMessage, status, error, stop, clearError, regenerate, setMessages } = useChat<OrbMessage>({
    transport: new DefaultChatTransport({
      api: chat?.endpoint ?? "/api/ai/agent/assistant",
      body: { institutionSlug, studentId: chat?.studentId },
    }),
  });
  const busy = status === "submitted" || status === "streaming";

  function send(text: string) {
    const t = text.trim();
    if (!chat || !t || busy) return;
    if (error) clearError();
    void sendMessage({ text: t });
    setInput("");
    setOpen(true);
  }

  const voice = useVoice({ onText: setInput, onDone: send, level: signals });
  const state = orbState({ status, typing: input.trim().length > 0, error: Boolean(error), listening: voice.listening });
  const hasTalk = Boolean(chat) && messages.length > 0;
  const showTranscript = hasTalk && (open || Boolean(error));

  return (
    <div
      className={`grid h-[calc(100dvh-10.5rem)] min-h-[32rem] grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto_auto] gap-3 lg:h-[calc(100dvh-7.5rem)] lg:grid-rows-[minmax(0,1fr)_auto] ${
        showTranscript ? "lg:grid-cols-[minmax(0,1fr)_23rem]" : ""
      }`}
    >
      <div className="relative min-h-0 lg:col-start-1 lg:row-start-1">
        {use3d ? (
          <OrbScene apps={apps} state={state} reduced={reduced} dark={dark} accent={accent} signals={signals} />
        ) : (
          <AppGrid apps={apps} />
        )}
        {chat && (
          <p className="pointer-events-none absolute right-3 top-3 z-[300] flex items-center gap-1.5 rounded-full border border-border bg-card/90 px-2.5 py-1 text-xs font-medium backdrop-blur">
            <span
              className={`size-2 rounded-full ${state === "idle" || state === "typing" ? "" : "animate-pulse"}`}
              style={{ background: state === "error" ? "var(--destructive)" : accent[1] }}
              aria-hidden
            />
            {STATE_LABEL[state]}
          </p>
        )}
        {hasTalk && !open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="absolute bottom-3 right-3 z-[300] inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium shadow-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MessagesSquare className="size-3.5" aria-hidden />
            Show conversation ({messages.length})
          </button>
        )}
      </div>
      {showTranscript && (
        <div className="h-[36dvh] min-h-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:h-auto">
          <OrbTranscript
            institutionSlug={institutionSlug}
            messages={messages}
            status={status}
            error={error ? chatErrorMessage(error) : null}
            accent={accent[1]}
            onRetry={() => {
              clearError();
              void regenerate();
            }}
            onDismissError={clearError}
            onNewChat={() => {
              if (busy) void stop();
              clearError();
              setMessages([]);
            }}
            onCollapse={() => setOpen(false)}
          />
        </div>
      )}
      <div className="min-w-0 lg:col-start-1 lg:row-start-2">
        <OrbComposer
          chatOn={Boolean(chat)}
          input={input}
          busy={busy}
          starters={starters}
          chips={chips}
          voice={voice}
          inputRef={inputRef}
          onInput={(v) => {
            setInput(v);
            signals.current.pulse = 1;
          }}
          onSend={send}
          onStop={() => void stop()}
        />
      </div>
    </div>
  );
}
