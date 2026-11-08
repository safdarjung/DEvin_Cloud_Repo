// Pre-filled assistant prompts per dashboard role. Shown on the dashboard's
// "Ask the data" panel (as /assistant?q= links) and as one-tap prompts on
// /assistant. Every prompt stays inside what the read-only assistant can
// answer (attendance and fees); nothing here grants access — the assistant
// route still checks the caller's own permissions per query.
import type { Role } from "@/lib/auth/permissions";

const LEADER = [
  "Summarise today's school operations",
  "Which sections have the lowest attendance this week?",
  "Identify students with repeated absences",
  "Summarise fee collection this term",
];

const BY_ROLE: Partial<Record<Role, string[]>> = {
  accountant: [
    "Summarise fee collection this term",
    "Which classes have the most outstanding fees?",
    "How many invoices are overdue right now?",
    "List the top defaulters this term",
  ],
  admissions: [
    "Give me today's attendance summary",
    "Which sections have the lowest attendance this week?",
    "Summarise fee collection this term",
  ],
  exam_controller: [
    "Which sections have the lowest attendance this week?",
    "Identify students with repeated absences",
    "Give me today's attendance summary",
  ],
};

export function assistantPromptsFor(role: Role): string[] {
  return BY_ROLE[role] ?? LEADER;
}
