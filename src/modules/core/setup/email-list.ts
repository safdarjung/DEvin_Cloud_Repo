// F18 §H step 4 — paste box → unique, lower-cased emails, split on newline,
// comma, semicolon or whitespace. Validity uses the same rule as
// InviteMemberSchema (zod email, ≤200 chars).
import { z } from "zod";

const EmailSchema = z.string().email().max(200);
export const MAX_INVITES_PER_BATCH = 50;

export interface ParsedEmails {
  valid: string[];
  invalid: string[];
  duplicates: number;
}

// invite_member needs a staff row for every staff-class role (0079), so each pasted address first gets a
// placeholder one, named after the address; the school can correct the name later in Staff.
export function staffFromEmail(email: string, role: string) {
  const local = email.split("@")[0] ?? email;
  const fullName = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  const designation = role.charAt(0).toUpperCase() + role.slice(1).replace(/_/g, " ");
  return {
    employeeNo: `INV-${crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    fullName: fullName || local,
    designation,
    email,
    isTeaching: role === "teacher",
  };
}

export function parseEmailList(text: string): ParsedEmails {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  let duplicates = 0;
  for (const token of text.split(/[\s,;]+/)) {
    const email = token.trim().toLowerCase();
    if (email === "") continue;
    if (seen.has(email)) {
      duplicates += 1;
      continue;
    }
    seen.add(email);
    (EmailSchema.safeParse(email).success ? valid : invalid).push(email);
  }
  return { valid, invalid, duplicates };
}
