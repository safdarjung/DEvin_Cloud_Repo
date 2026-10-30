// D29 — the teacher agent's routine/difficult routing heuristic. Honest
// caveat (recorded in the ADR, not hidden here): this layer only picks a
// tool and summarizes its result, so there is no strong intrinsic
// difficulty split to route on today. This is a cheap, explainable v1 —
// length plus a couple of multi-part cues — not a rigorous classifier.
import { describe, expect, it } from "vitest";
import { pickAgentProvider } from "@/modules/ai/agent/provider-routing";

describe("pickAgentProvider", () => {
  it("routes a short, single-ask message to groq", () => {
    expect(pickAgentProvider("hi")).toBe("groq");
    expect(pickAgentProvider("How many classes do I have assigned?")).toBe("groq");
    expect(pickAgentProvider("Look up Aarav Sharma and tell me his attendance.")).toBe("groq");
  });

  it("routes a long message to gemini", () => {
    expect(pickAgentProvider("a".repeat(221))).toBe("gemini");
  });

  it("routes a multi-part message to gemini even if short", () => {
    expect(pickAgentProvider("Compare Aarav's attendance and his Maths marks, and also draft a remark.")).toBe(
      "gemini",
    );
  });

  it("treats the message as the only signal — case/whitespace don't change the result", () => {
    expect(pickAgentProvider("  HI  ")).toBe("groq");
  });

  it("falls back to gemini for an empty or missing message (never guess down)", () => {
    expect(pickAgentProvider("")).toBe("gemini");
    expect(pickAgentProvider(undefined)).toBe("gemini");
  });
});
