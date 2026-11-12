import "server-only";
// GU-08 — the student study chat's tool set. Mirrors teacher-tools.ts's
// discipline: every tool closes over the caller's own authenticated `ctx`
// and a real RLS-respecting `createClient()`, never the admin client, and
// a failed lookup returns a plain error STRING, never a thrown exception
// (same reason as teacher-tools.ts: the model relays it and the stream
// keeps going).
import { tool } from "ai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { BlockSchema } from "@/modules/ai/blocks/schemas";
import { unitSearchWords, unitTitleScore } from "./unit-match";
import { escapeIlike } from "@/lib/list-search";
import { listStudyItems } from "@/modules/ai/student-study.queries";


function toolErrorMessage(toolName: string, err: unknown): string {
  const correlationId = crypto.randomUUID();
  console.error(`[${correlationId}] student agent tool "${toolName}" failed`, err);
  return `Something went wrong looking that up. Reference: ${correlationId}`;
}

type AgentClient = Awaited<ReturnType<typeof createClient>>;

/** This student's own active grade_id, derived from their own enrolment — never caller-supplied (there is no caller input to this function at all). */
async function myGradeId(supabase: AgentClient, ctx: TenantContext): Promise<string | null> {
  const studentId = ctx.membership.studentId;
  if (!studentId) return null;
  const { data, error } = await supabase
    .from("enrolments")
    .select("class_sections(grade_id)")
    .eq("institution_id", ctx.institution.id)
    .eq("student_id", studentId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const section = data?.class_sections as { grade_id: string } | null;
  return section?.grade_id ?? null;
}

/**
 * Builds the student study chat's tool set. `visualsEnabled` reflects the
 * `student_ai_visuals` entitlement (D33, child of `student_ai_study`):
 * when off, `showStudyBlocks` is simply not in the returned object, so the
 * model never sees it — the same effect `activeTools` would give, without
 * needing a separately pre-built, larger tool set to filter down from.
 */
export async function studentTools(ctx: TenantContext, options: { visualsEnabled: boolean }) {
  const supabase = await createClient();

  const findMyCurriculumUnit = tool({
    description:
      "Find a curriculum unit in your own grade by title (e.g. \"fractions\", \"photosynthesis\"). Returns up to 5 matches with their subject.",
    inputSchema: z.object({ query: z.string().trim().min(1).max(200) }),
    execute: async ({ query }) => {
      try {
        const gradeId = await myGradeId(supabase, ctx);
        if (!gradeId) return "You don't have an active enrolment, so no curriculum units are available.";

        // Word by word, as teacher-tools does: "acid bases and salts" must find "Acids, Bases and Salts".
        const words = unitSearchWords(query);
        const filter = (words.length ? words : [query.trim().toLowerCase()]).map((w) => `title.ilike.%${escapeIlike(w).replace(/[,()]/g, " ")}%`).join(",");
        const { data, error } = await supabase
          .from("curriculum_units")
          .select("id, title, subjects(name)")
          .eq("institution_id", ctx.institution.id)
          .eq("grade_id", gradeId)
          .or(filter)
          .limit(60);
        if (error) throw error;
        const ranked = (data ?? [])
          .map((row) => ({ row, score: unitTitleScore(row.title, words) }))
          .filter((r) => words.length === 0 || r.score >= 0.5)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map((r) => r.row);
        if (ranked.length === 0) return "No matching curriculum unit found in your grade.";

        return ranked.map((row) => ({
          id: row.id,
          title: row.title,
          subjectName: (row.subjects as { name: string } | null)?.name ?? "",
        }));
      } catch (err) {
        return toolErrorMessage("findMyCurriculumUnit", err);
      }
    },
  });

  // Own items only: listStudyItems filters by ctx.user.id and RLS; gated by the study_notebook capability's `tools`.
  const listMyStudyItems = tool({
    description: "List what this student has saved in their study notebook (title, kind, folder). Optional folder or title search.",
    inputSchema: z.object({ folder: z.string().trim().max(100).optional(), search: z.string().trim().max(100).optional() }),
    execute: async ({ folder, search }) => {
      try {
        const items = await listStudyItems(ctx, { folder: folder || undefined, search: search || undefined });
        return items.length === 0 ? "Nothing saved in the study notebook yet." : items.slice(0, 30);
      } catch (err) {
        return toolErrorMessage("listMyStudyItems", err);
      }
    },
  });

  if (!options.visualsEnabled) {
    return { findMyCurriculumUnit, listMyStudyItems };
  }

  const showStudyBlocks = tool({
    description:
      "Show the student one or more visual blocks (notes, a mindmap, a chart, flashcards, a practice quiz, or a callout) " +
      "alongside your reply. Use this when a visual or structured aid genuinely helps — not for every message. " +
      "Practice questions here are never graded or shown to a teacher.",
    inputSchema: z.object({ blocks: z.array(BlockSchema).min(1).max(5) }),
    // "Validated echo" (plan §GU-03): `inputSchema` is already enforced by
    // the AI SDK before this runs, so there is no second validation pass
    // to perform here, unlike the teacher agent's `runStructured`-backed
    // tools (which validate a *separate* generation call's free-form
    // output after the fact). This tool call's own arguments ARE the
    // content; execute() only needs to confirm receipt.
    execute: async ({ blocks }) => ({ shown: blocks.length }),
  });

  return { findMyCurriculumUnit, listMyStudyItems, showStudyBlocks };
}
