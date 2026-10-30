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
import { QuizReviewEditor } from "@/modules/ai/components/QuizReviewEditor";
import { RemarkDraftEditor } from "@/modules/exams/components/RemarkDraftEditor";
import type { QuizContent } from "@/modules/academics/assignments.schemas";

interface TeacherAgentChatProps {
  institutionSlug: string;
  aiPolicy: string;
  /** Teacher's own teachable sections (D28's `generateQuiz` is unit-scoped, not section-scoped), for the in-chat "save as assignment" form. */
  teachableSections: Array<{ id: string; label: string }>;
}

// Teacher-agent follow-up (D30 decision log) — the two draft tools' output
// shapes, narrowed from the generic `unknown` tool output so the matching
// review/save component (already used by the non-agent /ai/quiz and
// /ai/report-remark flows) can be rendered right in the chat. Saving still
// goes through those components' own existing actions unchanged — this is
// only presentation wiring, never a new write path.
interface QuizDraftOutput {
  draft: true;
  curriculumUnitId: string;
  subjectId: string;
  defaultTitle: string;
  questions: QuizContent["questions"];
}

function isQuizDraftOutput(output: unknown): output is QuizDraftOutput {
  return typeof output === "object" && output !== null && (output as { draft?: unknown }).draft === true && "curriculumUnitId" in output;
}

interface RemarkDraftOutput {
  draft: true;
  resultId: string;
  studentName: string;
  remark: string;
}

function isRemarkDraftOutput(output: unknown): output is RemarkDraftOutput {
  return typeof output === "object" && output !== null && (output as { draft?: unknown }).draft === true && "resultId" in output;
}

const TOOL_LABELS: Record<string, string> = {
  findStudent: "Looking up the student…",
  findCurriculumUnit: "Looking up the curriculum unit…",
  getAttendancePattern: "Checking attendance pattern…",
  getExamResults: "Looking up exam results…",
  getAssignmentStatus: "Looking up assignments…",
  generateQuiz: "Drafting a quiz…",
  draftResultRemark: "Drafting a report-card remark…",
};

function toolLabel(type: string): string {
  const name = type.startsWith("tool-") ? type.slice(5) : type;
  return TOOL_LABELS[name] ?? `Using ${name}…`;
}

interface MessagePartsProps {
  message: UIMessage;
  institutionSlug: string;
  aiPolicy: string;
  teachableSections: Array<{ id: string; label: string }>;
}

function MessageParts({ message, institutionSlug, aiPolicy, teachableSections }: MessagePartsProps) {
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
          const statusLine = (
            <div className="text-muted-foreground border-l-2 pl-2 text-xs italic">
              {done ? label.replace("…", " — done.") : label}
              {part.state === "output-error" && part.errorText ? ` (${part.errorText})` : ""}
            </div>
          );

          if (part.state === "output-available" && part.type === "tool-generateQuiz" && isQuizDraftOutput(part.output)) {
            return (
              <div key={index} className="space-y-2">
                {statusLine}
                {/* shortcut: `teachableSections` is this teacher's full section
                    list, not filtered to the unit's own grade+subject (the
                    manual /assignments/units/[unitId] flow filters it
                    server-side via listSectionSubjects). Picking a
                    mismatched section here still fails safely —
                    createAssignment re-checks scope — just with a save
                    error instead of a pre-filtered picker. Upgrade: add
                    gradeId to this tool's output and filter the same way. */}
                <QuizReviewEditor
                  institutionSlug={institutionSlug}
                  curriculumUnitId={part.output.curriculumUnitId}
                  subjectId={part.output.subjectId}
                  defaultTitle={part.output.defaultTitle}
                  sections={teachableSections}
                  aiPolicy={aiPolicy}
                  initialContent={{ questions: part.output.questions }}
                />
              </div>
            );
          }

          if (part.state === "output-available" && part.type === "tool-draftResultRemark" && isRemarkDraftOutput(part.output)) {
            return (
              <div key={index} className="space-y-2">
                {statusLine}
                <RemarkDraftEditor
                  institutionSlug={institutionSlug}
                  resultId={part.output.resultId}
                  studentName={part.output.studentName}
                  initialRemark={part.output.remark}
                  aiPolicy={aiPolicy}
                />
              </div>
            );
          }

          return <div key={index}>{statusLine}</div>;
        }
        return null;
      })}
    </>
  );
}

export function TeacherAgentChat({ institutionSlug, aiPolicy, teachableSections }: TeacherAgentChatProps) {
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
          {/* D29 — each message is routed to one of two cloud providers
              (Google Gemini or Groq); this banner must stay accurate for
              either, so it names both rather than claiming one. */}
          Google Gemini or Groq (cloud) — this assistant sends what you type, plus the data it looks up
          (students, curriculum, attendance, exam results), to one of these providers. It only drafts
          quizzes and remarks; you decide what to save.
        </div>
      </div>

      <Card>
        <CardContent className="flex h-[480px] flex-col gap-3 overflow-y-auto p-4 text-sm">
          {messages.length === 0 && (
            <p className="text-muted-foreground">
              Ask about a student, their attendance pattern, or draft a quiz or report-card remark — you can
              review and save a draft right here in the chat.
            </p>
          )}
          {messages.map((message) => (
            <div
              key={message.id}
              className={message.role === "user" ? "self-end text-right" : "self-start"}
            >
              <MessageParts
                message={message}
                institutionSlug={institutionSlug}
                aiPolicy={aiPolicy}
                teachableSections={teachableSections}
              />
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
