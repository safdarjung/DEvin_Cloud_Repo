"use client";

// App Orb: only a sphere of the person's apps, a one-line chat input and
// capability chips. Chat runs over the existing per-role endpoint.
import dynamic from "next/dynamic";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { chatErrorMessage } from "@/modules/ai/chat-error";
import { OrbChatPanel, type OrbChip, type OrbMessage } from "./OrbChatPanel";
import { ORB_ICONS } from "./orb-icons";
import { orbState } from "./orb-layout";
import type { OrbApp } from "./OrbScene";

const OrbScene = dynamic(() => import("./OrbScene"), { ssr: false });

export interface OrbChat {
  /** One of the existing role routes under /api/ai/agent. */
  endpoint: string;
  /** Guardians only: the selected child. */
  studentId?: string;
}

interface Props {
  institutionSlug: string;
  apps: OrbApp[];
  chat: OrbChat | null;
  chips: OrbChip[];
}

const subscribe = () => () => {};
function canRender3d(): boolean {
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

export function OrbView({ institutionSlug, apps, chat, chips }: Props) {
  const [input, setInput] = useState("");
  const use3d = useSyncExternalStore(subscribe, canRender3d, () => false);
  const { messages, sendMessage, status, error } = useChat<OrbMessage>({
    transport: new DefaultChatTransport({
      api: chat?.endpoint ?? "/api/ai/agent/assistant",
      body: { institutionSlug, studentId: chat?.studentId },
    }),
  });
  const busy = status === "submitted" || status === "streaming";
  const state = orbState({ status, typing: input.trim().length > 0, error: Boolean(error) });

  function send(text: string) {
    const t = text.trim();
    if (!chat || !t || busy) return;
    void sendMessage({ text: t });
    setInput("");
  }

  const appLinks = (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
      {apps.map((app) => {
        const Icon = ORB_ICONS[app.icon];
        return (
          <li key={app.href}>
            <Link href={app.href} className="flex items-center gap-2 rounded-lg border bg-card p-3 text-sm hover:bg-muted">
              <Icon className="size-4" aria-hidden />
              {app.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="relative h-[calc(100dvh-8rem)] min-h-[30rem]">
      {!use3d && <nav aria-label="Apps" className="pb-32">{appLinks}</nav>}
      {use3d && (
        <div className="absolute inset-x-0 top-0 bottom-28">
          <OrbScene apps={apps} state={state} />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 z-[200]">
      {chat ? (
        <OrbChatPanel
          institutionSlug={institutionSlug}
          messages={messages}
          input={input}
          busy={busy}
          chips={chips}
          error={error ? chatErrorMessage(error) : null}
          onInput={setInput}
          onSend={send}
        />
      ) : (
        <p className="text-center text-sm text-muted-foreground">AI is off for your role.</p>
      )}
      </div>
    </div>
  );
}
