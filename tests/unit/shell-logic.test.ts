import { describe, expect, test } from "vitest";
import { isEditableTarget, isInternalNav, matchShortcut, selectionQuestion } from "@/components/shell/shell-logic";
import { ORB_ASK_KEY, takeHandedQuestion } from "@/modules/ai/components/orb/orb-modes";

const key = (k: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey", boolean>> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });

describe("selectionQuestion", () => {
  test("returns null under three words", () => {
    expect(selectionQuestion("two words")).toBeNull();
    expect(selectionQuestion("  \n ")).toBeNull();
  });
  test("quotes the selection with its whitespace collapsed", () => {
    expect(selectionQuestion("fee  due\nthis term")).toBe('Tell me more about this: "fee due this term"');
  });
  test("caps the question at the orb's 500 chars", () => {
    expect(selectionQuestion("word ".repeat(300))!.length).toBeLessThanOrEqual(500);
  });
});

describe("takeHandedQuestion", () => {
  const storage = (value: string | null) => {
    const data = new Map<string, string>(value === null ? [] : [[ORB_ASK_KEY, value]]);
    return { getItem: (k: string) => data.get(k) ?? null, removeItem: (k: string) => void data.delete(k), data };
  };
  test("returns the question once and removes it, so a reload does not ask again", () => {
    const s = storage('Tell me more about this: "fee due this term"');
    expect(takeHandedQuestion(s)).toBe('Tell me more about this: "fee due this term"');
    expect(takeHandedQuestion(s)).toBeUndefined();
  });
  test("caps what it returns and ignores an empty value", () => {
    expect(takeHandedQuestion(storage("x".repeat(900)))!.length).toBe(500);
    expect(takeHandedQuestion(storage("   "))).toBeUndefined();
    expect(takeHandedQuestion(storage(null))).toBeUndefined();
  });
});

describe("matchShortcut", () => {
  test("Ctrl/Cmd+J opens the orb, even from a field", () => {
    expect(matchShortcut(key("j", { ctrlKey: true }), true)).toBe("orb");
    expect(matchShortcut(key("J", { metaKey: true }), false)).toBe("orb");
  });
  test("? opens help only outside fields and without modifiers", () => {
    expect(matchShortcut(key("?"), false)).toBe("help");
    expect(matchShortcut(key("?"), true)).toBeNull();
    expect(matchShortcut(key("?", { ctrlKey: true }), false)).toBeNull();
  });
  test("other keys do nothing", () => {
    expect(matchShortcut(key("k"), false)).toBeNull();
  });
});

describe("isEditableTarget", () => {
  test("detects inputs, textareas, selects and contenteditable", () => {
    expect(isEditableTarget({ tagName: "INPUT" } as Element)).toBe(true);
    expect(isEditableTarget({ tagName: "TEXTAREA" } as Element)).toBe(true);
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true } as unknown as Element)).toBe(true);
    expect(isEditableTarget({ tagName: "P" } as Element)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("isInternalNav", () => {
  const base = "http://localhost:3210/s/dashboard";
  test("true for a different in-app path", () => {
    expect(isInternalNav("http://localhost:3210/s/people", base)).toBe(true);
  });
  test("false for same path, other origin, or hash", () => {
    expect(isInternalNav("http://localhost:3210/s/dashboard?a=1", base)).toBe(false);
    expect(isInternalNav("https://example.com/x", base)).toBe(false);
    expect(isInternalNav("http://localhost:3210/s/dashboard#top", base)).toBe(false);
  });
});
