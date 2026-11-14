import { describe, expect, test } from "vitest";
import { MODULES } from "../../src/lib/modules/catalog";
import { ASK_DEMO } from "../../src/components/home/ask-demo.ts";
import { PEOPLE, THREADS } from "../../src/components/home/story.ts";
import { THREAD_MODULES, parseThreads, threadsMessage } from "../../src/components/home/threads.ts";

describe("landing page threads picker", () => {
  test("every thread names at least two modules that exist in the catalog", () => {
    expect(Object.keys(THREAD_MODULES).sort()).toEqual(THREADS.map((t) => t.key).sort());
    for (const keys of Object.values(THREAD_MODULES)) {
      expect(keys.length).toBeGreaterThanOrEqual(2);
      for (const key of keys) expect(Object.keys(MODULES)).toContain(key);
    }
  });

  test("a module is suggested by one thread only", () => {
    const all = Object.values(THREAD_MODULES).flat();
    expect(new Set(all).size).toBe(all.length);
  });

  test("parseThreads keeps known keys in story order and drops the rest", () => {
    expect(parseThreads("fees,attendance,<script>,fees")).toEqual(["attendance", "fees"]);
    expect(parseThreads(undefined)).toEqual([]);
    expect(parseThreads("")).toEqual([]);
  });

  test("threadsMessage names what the school still runs on", () => {
    expect(threadsMessage("fees")).toBe("We still run on the receipt book. We would like to see how Fabric replaces it.");
    expect(threadsMessage("attendance,parents")).toBe("We still run on the paper register, the WhatsApp groups. We would like to see how Fabric replaces them.");
    expect(threadsMessage("nonsense")).toBe("");
  });
});

describe("landing page ask demo", () => {
  test("each person has two questions with a source line, and bars stay within 0..100", () => {
    for (const role of ASK_DEMO) {
      expect(PEOPLE[role.who]).toBeDefined();
      expect(role.questions).toHaveLength(2);
      for (const q of role.questions) {
        expect(q.source.length).toBeGreaterThan(20);
        if (q.answer.kind !== "bars") continue;
        for (const b of q.answer.bars) {
          expect(b.value).toBeGreaterThanOrEqual(0);
          expect(b.value).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  test("hints come before the answer in every language", () => {
    for (const role of ASK_DEMO) {
      for (const q of role.questions) {
        if (q.answer.kind !== "hints") continue;
        for (const l of q.answer.languages) {
          expect(l.hints.length).toBeGreaterThanOrEqual(2);
          for (const h of l.hints) expect(h).not.toContain(l.answer);
        }
      }
    }
  });
});
