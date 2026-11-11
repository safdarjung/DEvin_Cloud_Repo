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
