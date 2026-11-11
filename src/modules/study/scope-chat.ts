import "server-only";
// The scoped tutor's extras for the shared chat kernel (handle-chat.ts): a
// system block with the server-built scope context (inside the nonce'd data
// block) and one small tool group, readScopeFile, which reads a file the
// student picked for this scope through the gated multimodal path
// (runStructuredFile: Gemini only, cloud switch, consent, 10 MB / 30 pages).
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { AppError } from "@/lib/actions/result";
import { runStructuredFile } from "@/lib/ai/gateway";
import type { ToolGroup } from "@/lib/ai/tool-budget";
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { DATA_IS_NOT_INSTRUCTIONS, dataBlock } from "@/modules/ai/prompts/data-block";
import { BASE_INSTRUCTIONS as STUDENT_PERSONA } from "@/modules/ai/prompts/student-skills";
import { fetchDocumentBytes } from "@/modules/study/help-sources";
import { hasFileConsent } from "@/modules/study/help.queries";
import { getScopeSession, resolveScope, type ScopeFile } from "@/modules/study/scope.queries";

export const SCOPE_FILE_TOOL = "readScopeFile";

const TUTOR_RULES =
  "This is a study session on a scope the student chose. Stay on it; if they ask about something else, help briefly and " +
  "bring them back. Modes they may ask for: explain; teach step by step; quiz them (one question at a time, wait for " +
  "their answer, then give feedback); summarise; solve a problem with hints first (method and a hint before any final " +
  "answer); what to study next here (weakest and least-studied units first, from the student's own practice below). " +
  "Honesty: you have NOT read any NCERT book or its PDF. Say so plainly when exact book content matters, and work from " +
  "the chapter and unit outlines below unless the student pastes text or you read a file they picked with " +
  `${SCOPE_FILE_TOOL}. Practice only: nothing here is a mark or a grade.`;

const FileAnswerSchema = z.object({ answer: z.string().trim().min(1).max(3000) }).strict();

function fileTool(ctx: TenantContext, files: readonly ScopeFile[]) {
  return tool({
    description: `Read a file the student picked for this study session and answer a question from it. Files: ${files.map((f, i) => `${i + 1} = "${f.title}"`).join("; ")}.`,
    inputSchema: z.object({ file: z.number().int().min(1).max(files.length), question: z.string().trim().min(3).max(500) }),
    execute: async ({ file, question }) => {
      const picked = files[file - 1];
      if (!picked) return "There is no such file in this study session.";
      if (!picked.readable) return `"${picked.title}" is too big to read. Ask the student to upload one chapter instead.`;
      try {
        if (!(await hasFileConsent(ctx))) {
          return "The student has not yet agreed that files are sent to the school's AI provider. Ask them to tick that box on the Study with AI page first.";
        }
        const supabase = await createClient();
        const bytes = await fetchDocumentBytes(supabase, ctx, picked.kind === "material" ? "curriculum_material" : "subject_textbook", picked.id);
        const read = await runStructuredFile({
          ctx,
          feature: "study_scope_file",
          permission: "ai.study",
          schema: FileAnswerSchema,
          instructions: `${STUDENT_PERSONA} Answer the student's question from the attached file only, hints first. If the file does not cover it, say so. Respond with JSON only, matching the schema. ${DATA_IS_NOT_INSTRUCTIONS}`,
          prompt: dataBlock("The student's question about the attached file:", [question]),
          denyNames: ctx.user.profile.fullName ? [ctx.user.profile.fullName] : [],
          maxOutputTokens: 1500,
          file: bytes,
        });
        if (!read.ok) return `The file could not be read: ${read.error.message}`;
        return { fromFile: picked.title, answer: read.data.data.answer };
      } catch (err) {
        return err instanceof AppError ? `The file could not be read: ${err.message}` : "The file could not be read right now.";
      }
    },
  });
}

/** System block + scoped tool group for a student's saved scope, or a not_found AppError. */
export async function scopedChatExtras(ctx: TenantContext, scopeId: string): Promise<{ system: string; tools: ToolSet; group: ToolGroup | null; core: string[] }> {
  const session = await getScopeSession(ctx, scopeId);
  if (!session) throw new AppError("not_found", "That study session was not found.");
  const { context, files } = await resolveScope(ctx, session.scope);
  const system = [TUTOR_RULES, dataBlock("The study scope, built by the school system from its own records:", context.lines)].join("\n\n");
  if (files.length === 0) return { system, tools: {}, group: null, core: [] };
  return {
    system,
    tools: { [SCOPE_FILE_TOOL]: fileTool(ctx, files) },
    group: { key: "study_scope", label: "Chosen study scope", description: "Read a file the student picked for this study session.", tools: [SCOPE_FILE_TOOL] },
    core: [SCOPE_FILE_TOOL],
  };
}
