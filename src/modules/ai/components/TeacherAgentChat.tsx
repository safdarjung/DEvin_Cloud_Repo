"use client";

// T-0NN — client chat UI for the teacher tool-calling agent (D28). This is
// the first real surface at `/ai`; the honesty banner below is rule 7's
// cloud-disclosure label — deliberately the opposite of the
// local-first framing elsewhere in the app, so it must never look like a
// generic/accidental badge.
import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface TeacherAgentChatProps {
  institutionSlug: string;
}

const TOOL_LABELS: Record<string, string> = {
  findStudent: "Looking up the student…",
  findCurriculumUnit: "Looking up the curriculum unit…",
  getAttendancePattern: "Checking attendance pattern…",
  generateQuiz: "Drafting a quiz…",
  draftResultRemark: "Drafting a report-card remark…",
};

function toolLabel(type: string): string {
  const name = type.startsWith("tool-") ? type.slice(5) : type;
  return TOOL_LABELS[name] ?? `Using ${name}…`;
}

function MessageParts({ message }: { message: UIMessage }) {
  return (
    <>
      {message.parts.map((part, index) => {
        if (part.type === "text") {
          return (
            <p key={index} className="whitespace-pre-wrap">
              {part.text}
            </p>
          );
        }
        if (isToolUIPart(part)) {
          const label = toolLabel(part.type);
          const done = part.state === "output-available" || part.state === "output-error";
          return (
            <div key={index} className="text-muted-foreground border-l-2 pl-2 text-xs italic">
              {done ? label.replace("…", " — done.") : label}
              {part.state === "output-error" && part.errorText ? ` (${part.errorText})` : ""}
            </div>
          );
        }
        return null;
      })}
    </>
  );
}

export function TeacherAgentChat({ institutionSlug }: TeacherAgentChatProps) {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/ai/agent/teacher",
      body: { institutionSlug },
    }),
  });

  const busy = status === "submitted" || status === "streaming";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    void sendMessage({ text });
    setInput("");
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">AI Assistant</h1>
        <div className="mt-2 rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          Google Gemini (cloud) — this assistant sends what you type, plus the data it looks up (students,
          curriculum, attendance, exam results), to Google. It only drafts quizzes and remarks; you decide
          what to save.
        </div>
      </div>

      <Card>
        <CardContent className="flex h-[480px] flex-col gap-3 overflow-y-auto p-4 text-sm">
          {messages.length === 0 && (
            <p className="text-muted-foreground">
              Ask about a student, their attendance pattern, or draft a quiz or report-card remark.
            </p>
          )}
          {messages.map((message) => (
            <div
              key={message.id}
              className={message.role === "user" ? "self-end text-right" : "self-start"}
            >
              <MessageParts message={message} />
            </div>
          ))}
          {error && <p className="text-destructive text-sm">{error.message}</p>}
        </CardContent>
      </Card>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. How has Aarav Sharma's attendance been this term?"
          disabled={busy}
        />
        <Button type="submit" disabled={busy || input.trim().length === 0}>
          Send
        </Button>
      </form>
    </div>
  );
}
