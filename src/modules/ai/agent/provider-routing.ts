// D29 — routes the teacher agent's top-level conversational model between
// Groq (fast, free-tier, routine) and Gemini (D28's existing default).
// Honest limit, recorded in the ADR: this model only picks a tool and
// summarizes its result in a sentence or two — quiz/remark DRAFTING, the
// one genuinely hard generation task, already runs through a separate
// gateway call inside the tool itself (teacher-tools.ts), not this model.
// So there is no strong intrinsic difficulty split at this layer; this is
// a cheap, explainable v1 (length + a couple of multi-part cues), not a
// classifier, and errs toward Gemini whenever it's unsure.
const LENGTH_THRESHOLD = 220;
const MULTI_PART_PATTERN = /\band also\b|\bas well as\b|\bcompare\b|\bboth\b/i;

// "zai" is never a routing pick: with its key it answers first (cloudProviderPlan).
// "nim" (NVIDIA NIM) is never a routing pick either: with its key it answers first (owner, 2026-11-12).
export type AgentProvider = "groq" | "gemini" | "zai" | "nim";

export function pickAgentProvider(latestUserText: string | undefined): AgentProvider {
  const text = latestUserText?.trim();
  if (!text) return "gemini";
  if (text.length > LENGTH_THRESHOLD) return "gemini";
  if (MULTI_PART_PATTERN.test(text)) return "gemini";
  return "groq";
}
