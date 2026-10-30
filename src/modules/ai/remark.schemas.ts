// T-0NN — result-remark draft schema (06 §W6, lesson 9: structured-output
// strings capped at 500 chars). 500 is also the field's real DB limit
// (0047's `char_length(remark) between 1 and 500`) and the quiz route's
// confirmed-safe bisected threshold (GENERATION_MAX_STRING_LENGTH in
// quiz.schemas.ts) — no separate "generation" vs. "real" schema split is
// needed here since there is only the one short field, unlike quiz's
// multi-question content.
import { z } from "zod";

export const RemarkGenerationSchema = z
  .object({
    remark: z.string().trim().min(1).max(500),
  })
  .strict();

export type RemarkGeneration = z.infer<typeof RemarkGenerationSchema>;
