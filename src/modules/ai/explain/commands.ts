// Orb slash commands. Pure: the orb calls parseOrbCommand on what the person
// typed; null means "not a command", so normal chat (including other text that
// starts with a slash) is untouched.
export type OrbCommandName = "anatomy" | "teardown" | "infographic" | "mindmap" | "diagram" | "image";

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
