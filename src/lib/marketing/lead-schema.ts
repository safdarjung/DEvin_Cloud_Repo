import { z } from "zod";

// Honeypot `website` must stay empty; the route silently drops filled ones.
export const LeadInputSchema = z.object({
  kind: z.enum(["demo", "contact"]),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().max(200).email(),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  institution: z.string().trim().max(200).optional().or(z.literal("")),
  role: z.string().trim().max(100).optional().or(z.literal("")),
  message: z.string().trim().max(2000).optional().or(z.literal("")),
  website: z.string().default(""),
});

export type LeadInput = z.infer<typeof LeadInputSchema>;
