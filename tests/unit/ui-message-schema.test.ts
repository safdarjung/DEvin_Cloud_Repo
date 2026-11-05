import { describe, it, expect } from "vitest";
import { z } from "zod";
import { stripToText, latestUserText, UIMessageRequestSchema } from "@/lib/ai/ui-message-schema";

type TestMessage = z.infer<typeof UIMessageRequestSchema>;

describe("ui-message-schema", () => {
  describe("stripToText", () => {
    it("drops system messages", () => {
      const messages: TestMessage[] = [
        { id: "1", role: "system", parts: [{ type: "text", text: "system prompt" }] } as TestMessage,
        { id: "2", role: "user", parts: [{ type: "text", text: "hello" }] } as TestMessage,
      ];
      const result = stripToText(messages);
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe("user");
    });

    it("drops tool parts and reasoning parts, keeps text", () => {
      const messages: TestMessage[] = [
        {
          id: "1",
          role: "assistant",
          parts: [
            { type: "text", text: "I will help" },
            { type: "tool-call", toolUseId: "t1", toolName: "search", args: {} },
            { type: "reasoning", thinking: "let me think" },
          ],
        } as TestMessage,
      ];
      const result = stripToText(messages);
      expect(result).toHaveLength(1);
      expect(result[0].parts).toHaveLength(1);
      const part = result[0].parts[0] as { type: string; text?: string };
      expect(part.type).toBe("text");
      expect(part.text).toBe("I will help");
    });

    it("drops assistant message with only a tool part", () => {
      const messages: TestMessage[] = [
        { id: "1", role: "user", parts: [{ type: "text", text: "hello" }] } as TestMessage,
        { id: "2", role: "assistant", parts: [{ type: "tool-call", toolUseId: "t1", toolName: "search", args: {} }] } as TestMessage,
      ];
      const result = stripToText(messages);
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe("user");
    });

    it("preserves order of user and assistant messages", () => {
      const messages: TestMessage[] = [
        { id: "1", role: "user", parts: [{ type: "text", text: "first" }] } as TestMessage,
        { id: "2", role: "assistant", parts: [{ type: "text", text: "second" }] } as TestMessage,
        { id: "3", role: "user", parts: [{ type: "text", text: "third" }] } as TestMessage,
      ];
      const result = stripToText(messages);
      expect(result).toHaveLength(3);
      expect((result[0].parts[0] as { text?: string }).text).toBe("first");
      expect((result[1].parts[0] as { text?: string }).text).toBe("second");
      expect((result[2].parts[0] as { text?: string }).text).toBe("third");
    });

    it("keeps multiple text parts in a message", () => {
      const messages: TestMessage[] = [
        {
          id: "1",
          role: "user",
          parts: [
            { type: "text", text: "hello" },
            { type: "text", text: "world" },
          ],
        } as TestMessage,
      ];
      const result = stripToText(messages);
      expect(result).toHaveLength(1);
      expect(result[0].parts).toHaveLength(2);
    });

    it("returns empty array when all messages are system or tool-only", () => {
      const messages: TestMessage[] = [
        { id: "1", role: "system", parts: [{ type: "text", text: "system prompt" }] } as TestMessage,
        { id: "2", role: "assistant", parts: [{ type: "tool-call", toolUseId: "t1", toolName: "search", args: {} }] } as TestMessage,
      ];
      const result = stripToText(messages);
      expect(result).toHaveLength(0);
    });
  });

  describe("latestUserText", () => {
    it("returns text parts from the last user message joined with space", () => {
      const messages: TestMessage[] = [
        { id: "1", role: "user", parts: [{ type: "text", text: "hello" }] } as TestMessage,
        { id: "2", role: "assistant", parts: [{ type: "text", text: "hi" }] } as TestMessage,
        {
          id: "3",
          role: "user",
          parts: [
            { type: "text", text: "what" },
            { type: "text", text: "is" },
            { type: "text", text: "this" },
          ],
        } as TestMessage,
      ];
      const result = latestUserText(messages);
      expect(result).toBe("what is this");
    });

    it("returns undefined when no user message exists", () => {
      const messages: TestMessage[] = [
        { id: "1", role: "system", parts: [{ type: "text", text: "system" }] } as TestMessage,
        { id: "2", role: "assistant", parts: [{ type: "text", text: "hi" }] } as TestMessage,
      ];
      const result = latestUserText(messages);
      expect(result).toBeUndefined();
    });

    it("ignores non-text parts in the last user message", () => {
      const messages: TestMessage[] = [
        { id: "1", role: "user", parts: [{ type: "text", text: "hello" }] } as TestMessage,
        {
          id: "2",
          role: "user",
          parts: [
            { type: "tool-call", toolUseId: "t1", toolName: "search", args: {} },
            { type: "text", text: "final" },
          ],
        } as TestMessage,
      ];
      const result = latestUserText(messages);
      expect(result).toBe("final");
    });

    it("returns empty string when last user message has no text parts", () => {
      const messages: TestMessage[] = [
        { id: "1", role: "user", parts: [{ type: "text", text: "hello" }] } as TestMessage,
        { id: "2", role: "user", parts: [{ type: "tool-call", toolUseId: "t1", toolName: "search", args: {} }] } as TestMessage,
      ];
      const result = latestUserText(messages);
      expect(result).toBe("");
    });

    it("handles messages after the last user message", () => {
      const messages: TestMessage[] = [
        { id: "1", role: "user", parts: [{ type: "text", text: "question" }] } as TestMessage,
        { id: "2", role: "assistant", parts: [{ type: "text", text: "answer" }] } as TestMessage,
        { id: "3", role: "assistant", parts: [{ type: "text", text: "more" }] } as TestMessage,
      ];
      const result = latestUserText(messages);
      expect(result).toBe("question");
    });
  });
});
