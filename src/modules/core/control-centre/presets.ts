// Control centre presets: a mode set per preset, applied to one role or all.
// A preset clears group and task overrides so the result is exactly the stated set.
import type { Role } from "../../../lib/auth/permissions.ts";
import type { OrbMode } from "../../ai/tasks/types";
import { ORB_MODES, modeLabel } from "./ids.ts";
import type { AiRolePatch } from "./merge.ts";
import { MODE_DEFAULT, modeOn, roleChatOn, roleName, type CcModel, type CcSettings } from "./state.ts";

export type PresetId = "ask_only" | "teacher_assist" | "office_operations" | "full_orb" | "everything_off";

export interface Preset {
  id: PresetId;
  label: string;
  description: string;
  /** Modes switched on; the rest go off. */
  modes: readonly OrbMode[];
  /** AI chat for the role: on for every preset but "Everything off". */
  chat: boolean;
}

export const PRESETS: readonly Preset[] = [
  { id: "ask_only", label: "Ask only", description: "Questions and answers only. The orb proposes nothing.", modes: ["ask"], chat: true },
  { id: "teacher_assist", label: "Teacher assist", description: "Ask, Do, Create and Teach. No setup changes.", modes: ["ask", "do", "create", "teach"], chat: true },
  { id: "office_operations", label: "Office operations", description: "Ask, Do, Create and Manage for the school office.", modes: ["ask", "do", "create", "manage"], chat: true },
  { id: "full_orb", label: "Full orb", description: "Every mode on.", modes: ORB_MODES, chat: true },
  { id: "everything_off", label: "Everything off", description: "AI is switched off for the role.", modes: [], chat: false },
];

const nulls = (o: Record<string, unknown> | undefined): Record<string, null> => Object.fromEntries(Object.keys(o ?? {}).map((k) => [k, null]));

export function presetPatch(preset: Preset, role: Role, s: CcSettings): AiRolePatch {
  const cfg = s.ai_roles[role];
  return {
    enabled: preset.chat,
    modes: Object.fromEntries(ORB_MODES.map((m) => [m, preset.modes.includes(m)])),
    groups: nulls(cfg?.groups),
    tasks: nulls(cfg?.tasks),
  };
}

/** Reset: every override goes; the AI chat switch returns to its default. */
export function resetPatch(m: CcModel, role: Role, s: CcSettings): AiRolePatch {
  const cfg = s.ai_roles[role];
  return { enabled: m.roleEnabledDefault[role], modes: nulls(cfg?.modes), groups: nulls(cfg?.groups), tasks: nulls(cfg?.tasks), capabilities: nulls(cfg?.capabilities) };
}

export interface PresetPreview {
  role: Role;
  lines: string[];
}

/** What applying a patch would change for each role, in words. */
export function previewPatch(m: CcModel, s: CcSettings, roles: readonly Role[], patchOf: (role: Role) => AiRolePatch): PresetPreview[] {
  return roles.map((role) => {
    const p = patchOf(role);
    const lines: string[] = [];
    if (p.enabled !== undefined && p.enabled !== roleChatOn(m, s, role)) lines.push(`AI for ${roleName(role)}: ${p.enabled ? "off to on" : "on to off"}`);
    for (const mode of ORB_MODES) {
      const was = modeOn(s, role, mode);
      const next = p.modes?.[mode] === undefined ? was : p.modes[mode] ?? MODE_DEFAULT[mode];
      if (next !== was) lines.push(`${modeLabel(mode)} mode: ${was ? "on to off" : "off to on"}`);
    }
    const cleared = (["groups", "tasks", "capabilities"] as const).reduce((n, k) => n + Object.keys(s.ai_roles[role]?.[k] ?? {}).filter((key) => p[k]?.[key] === null).length, 0);
    if (cleared > 0) lines.push(`Clears ${cleared} group, task and tool override${cleared === 1 ? "" : "s"}`);
    return { role, lines };
  });
}
