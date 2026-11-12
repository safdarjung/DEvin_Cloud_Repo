// Orb slash commands. Pure: the orb calls parseOrbCommand on what the person
// typed; null means "not a command", so normal chat (including other text that
// starts with a slash) is untouched.
export type OrbCommandName = "anatomy" | "teardown" | "infographic" | "mindmap" | "diagram" | "flashcards" | "lessonplan" | "image";

export interface OrbCommand {
  name: OrbCommandName;
  usage: string;
  help: string;
}

export const ORB_COMMANDS: readonly OrbCommand[] = [
  { name: "anatomy", usage: "/anatomy <thing>", help: "Name the parts of a thing and what each one does." },
  { name: "teardown", usage: "/teardown <thing>", help: "Take a thing apart layer by layer: how it works and why it is built that way." },
  { name: "infographic", usage: "/infographic <topic>", help: "Make a one-page poster of a topic you can print or save as PDF." },
  { name: "mindmap", usage: "/mindmap <topic>", help: "Draw a topic as a mind map you can save as a picture." },
  { name: "diagram", usage: "/diagram <process>", help: "Draw a process, cycle or decision as a flowchart you can save as a picture." },
  { name: "flashcards", usage: "/flashcards <topic>", help: "Make a deck of flashcards to flip through and practise." },
  { name: "lessonplan", usage: "/lessonplan <chapter, class, length>", help: "Write a full timed lesson plan (teachers), e.g. /lessonplan Class 10 acids bases and salts, 40 min." },
  { name: "image", usage: "/image <what to draw>", help: "Draw an illustration for a lesson (made by the cloud AI; check it before you use it)." },
];

const NAMES = new Set<string>(ORB_COMMANDS.map((c) => c.name));

export function parseOrbCommand(text: string): { command: OrbCommandName; arg: string } | null {
  const m = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!m) return null;
  const command = m[1].toLowerCase();
  if (!NAMES.has(command)) return null;
  return { command: command as OrbCommandName, arg: (m[2] ?? "").trim() };
}

// "make me a mind map of the water cycle", "draw a flowchart for admission": said in words, not as a command.
// Only a clear request with a topic after it counts; anything else stays a normal chat message.
const ASK = /\b(?:mind[\s-]?map|flow[\s-]?chart|flow diagram|diagram|flash\s?cards?)\b/i;
const TOPIC = /\b(?:mind[\s-]?map|flow[\s-]?chart|flow diagram|diagram|flash\s?cards?)s?\s+(?:of|for|on|about|showing|explaining)\s+(.{3,200})$/i;
const MAKE = /\b(?:make|draw|create|generate|build|show|give|prepare|do)\b/i;

export function naturalVisualRequest(text: string): { command: "mindmap" | "diagram" | "flashcards"; arg: string } | null {
  const t = text.trim();
  if (t.length > 300 || t.startsWith("/") || !ASK.test(t) || !MAKE.test(t) || /\?\s*$/.test(t)) return null;
  // "a mind map and flashcards for X": the map is drawn; flashcards are a Study studio feature.
  const m = TOPIC.exec(t.replace(/\s+(?:and|&|,)\s+(?:some\s+)?(?:flash\s?cards?|a quiz|notes)\b/i, ""));
  const topic = m?.[1]?.replace(/\s+and\s+(?:flash\s?cards?|a quiz|notes)\b.*$/i, "").replace(/[.!]+$/, "").trim();
  if (!topic || topic.length < 3) return null;
  return { command: /mind[\s-]?map/i.test(t) ? "mindmap" : /flash\s?cards?/i.test(t) && !/flow/i.test(t) ? "flashcards" : "diagram", arg: topic };
}

// Words that say "a lesson plan" but no lesson: what is left after removing them must name a topic.
const PLAN_FILLER =
  /\b(?:please|pls|can|could|would|you|u|i|me|my|we|our|wanna|want|to|need|help|draft|make|create|write|prepare|generate|build|give|plan|plans|lesson|lessons|a|an|the|for|on|about|of|with|curriculum|unit|units|teach|teaching|it|this|that|some|one|minutes?|mins?|min|period|periods|\d+[- ]?minutes?|\d+[- ]?mins?)\b/gi;

/** "lesson plan for class 10 acids bases and salts tomorrow": the whole request goes to /lessonplan (the model reads class, length and chapter). */
export function naturalLessonPlan(text: string): string | null {
  const t = text.trim();
  if (t.length > 300 || t.startsWith("/") || !/\blesson[\s-]?plans?\b/i.test(t)) return null;
  const rest = t.replace(PLAN_FILLER, " ").replace(/[^a-z0-9\u0900-\u097f]+/gi, " ").trim();
  return rest.split(" ").filter((w) => w.length > 1).length >= 1 ? t : null;
}
