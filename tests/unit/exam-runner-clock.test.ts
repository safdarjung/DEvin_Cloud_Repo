// Exam runner: the clock starts when the server answered, not at hydration; a partly matched match question autosaves with null for unmatched pairs.
import { afterEach, describe, expect, it, vi } from "vitest";
import { isAnswered } from "@/modules/online-tests/components/AnswerInput";
import { markDocumentTimingUsed, responseAt } from "@/modules/online-tests/components/runner-clock";
import { SaveResponseSchema } from "@/modules/online-tests/schemas";

function fakeBrowser(navUrl: string, path: string, responseStart: number, now: number) {
  vi.stubGlobal("window", { location: { pathname: path } });
  vi.stubGlobal("performance", { now: () => now, getEntriesByType: () => [{ name: navUrl, responseStart }] });
}

afterEach(() => vi.unstubAllGlobals());

describe("exam runner clock origin", () => {
  it("a reload of the runner page counts from the document response, not hydration", () => {
    fakeBrowser("http://localhost/demo/portal/tests/run/a1", "/demo/portal/tests/run/a1", 120, 4_000);
    expect(responseAt()).toBe(120);
  });

  it("a client navigation into the runner counts from now", () => {
    fakeBrowser("http://localhost/demo/portal/tests", "/demo/portal/tests/run/a1", 120, 4_000);
    expect(responseAt()).toBe(4_000);
  });

  it("after the first runner mount, the document timing is not reused", () => {
    markDocumentTimingUsed();
    fakeBrowser("http://localhost/demo/portal/tests/run/a1", "/demo/portal/tests/run/a1", 120, 9_000);
    expect(responseAt()).toBe(9_000);
  });
});

describe("partial match answers", () => {
  const save = (answer: unknown) => SaveResponseSchema.safeParse({ attemptId: "00000000-0000-4000-8000-000000000001", itemKey: "00000000-0000-4000-8000-000000000002", answer });

  it("accepts null for an unmatched pair and counts a partial match as answered", () => {
    expect(save([0, null, 2]).success).toBe(true);
    expect(isAnswered([0, null, 2])).toBe(true);
  });

  it("an all-unmatched list is not an answer; negative indices stay invalid", () => {
    expect(isAnswered([null, null])).toBe(false);
    expect(save([-1, 2]).success).toBe(false);
  });
});
