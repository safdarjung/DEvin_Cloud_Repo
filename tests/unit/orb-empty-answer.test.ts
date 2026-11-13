// Owner bug 2026-11-12: a student's orb answer showed only the "Generated in cloud" badge —
// the model's turn ended on tool calls whose outputs draw nothing. Such a turn must say something.
import { describe, expect, it } from "vitest";
import { answerShows } from "@/modules/ai/components/orb/OrbTranscript";

type Parts = Parameters<typeof answerShows>[0];
const read = (output: unknown) => ({ type: "tool-mastery_gapsForStudent", toolCallId: "c1", state: "output-available", input: {}, output }) as unknown as Parts[number];

describe("answerShows", () => {
  it("a turn of only data-tool outputs and no text shows nothing (so the fallback line is drawn)", () => {
    expect(answerShows([read("<data-x>[]</data-x>"), read("Loaded Study: a, b")])).toBe(false);
  });

  it("blank text counts as nothing", () => {
    expect(answerShows([{ type: "text", text: "  \n" } as Parts[number]])).toBe(false);
  });

  it("a leaked, malformed tool call as text counts as nothing (seen 2026-11-13 on a student chip)", () => {
    for (const text of [
      "(function kinases_functions最 Burke function",
      'functions.mastery_gapsForStudent({"studentId": "x"})',
      '{"name": "propose_task", "arguments": {}}',
      'Let me check.<tool_call>{"name":"x"}</tool_call>',
    ]) {
      expect(answerShows([{ type: "text", text } as Parts[number]])).toBe(false);
    }
  });

  it("prose that mentions functions is still an answer", () => {
    for (const text of ["A function maps each x to one y.", "(f ∘ g)(x) means apply g first.", "Function notation: f(x) = 2x + 1"]) {
      expect(answerShows([{ type: "text", text } as Parts[number]])).toBe(true);
    }
  });

  it("text, a pending tool line, or a navigate link count as an answer", () => {
    expect(answerShows([{ type: "text", text: "Day 1: fractions" } as Parts[number]])).toBe(true);
    expect(answerShows([{ type: "tool-x", toolCallId: "c", state: "input-available", input: {} } as unknown as Parts[number]])).toBe(true);
    expect(answerShows([{ type: "tool-navigate", toolCallId: "c", state: "output-available", input: {}, output: { href: "/demo/fees", label: "Fees" } } as unknown as Parts[number]])).toBe(true);
  });
});
