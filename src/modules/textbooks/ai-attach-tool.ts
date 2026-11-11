import "server-only";
// "Attach via the AI" (0139). The chat attach control uploads a file through
// the same path as the UI (curriculum.material.requestUpload/confirmUpload,
// unfiled and private), then tells the model only the file name, size, id
// and the person's own subjects/units. This tool turns the model's choice
// into a draft card; nothing is attached until the person confirms, and the
// card calls curriculum.material.attach — the action the "My files" UI uses,
// which re-checks permission and RLS. The model never sees file bytes.
import { tool, type Tool } from "ai";
import { z } from "zod";
import type { ToolGroup } from "@/lib/ai/tool-budget";
import type { Role } from "@/lib/auth/permissions";
import { hasPermission } from "@/lib/auth/require";
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { describeInput } from "@/modules/agents/tools";
import { uuid } from "@/lib/schemas/common";
import { attachTargets, myUnfiled } from "./materials.queries";
import { AttachMaterialSchema, SHARE_OPTIONS } from "./schemas";

export const FILE_ATTACH_TOOL = "draft_curriculum_material_attach";
export const FILE_ATTACH_GROUP: ToolGroup = {
  key: "file_attach",
  label: "File upload attach",
  description: "Propose where to attach a file the person uploaded in chat: subject, unit and who can see it. Not attached until they confirm.",
  tools: [FILE_ATTACH_TOOL],
};

// Tool budget: only offered when the conversation is about a file upload.
const MENTION = /\b(attach(ed|ing)?|upload(ed|ing)?|pdf|file|files)\b/i;
export function mentionsFileAttach(texts: readonly string[]): boolean {
  return texts.some((t) => MENTION.test(t));
}

// What the model must give is only the subject; small local models drop fields, so the
// rest is filled from the person's own data (their latest unfiled upload, the subject's
// only grade, the role's default share) and then checked against the action's schema.
const blank = (v: unknown) => (v === "" || v === null ? undefined : v);
const ProposeSchema = z.object({
  subjectId: uuid,
  materialId: z.preprocess(blank, uuid.optional()),
  gradeId: z.preprocess(blank, uuid.optional()),
  unitId: z.preprocess(blank, uuid.optional()),
  share: z.preprocess(blank, z.enum(SHARE_OPTIONS).optional()),
  title: z.preprocess(blank, z.string().trim().min(1).max(160).optional()),
});

const SHARE_LABEL = { private: "private (only you)", class: "shared with the class", suggest: "suggested to the subject teacher" } as const;

/** The draft tool for teachers and students (not previews, not other roles), or null. */
export function fileAttachTool(ctx: TenantContext, personaRole: Role, texts: readonly string[]): Tool | null {
  const role = ctx.membership.role;
  if (personaRole !== role || (role !== "teacher" && role !== "student")) return null;
  if (!hasPermission(ctx, "academics.read") || !mentionsFileAttach(texts)) return null;
  return tool({
    description:
      role === "student"
        ? "Propose where to file a file the student uploaded (by file id): one of their subjects and units; share 'private' or 'suggest' (offer to the teacher). The student confirms; you never attach it."
        : "Propose where to file a file the teacher uploaded (by file id): one of their taught subjects and units; share 'class' or 'private'. The teacher confirms; you never attach it.",
    inputSchema: describeInput(ProposeSchema),
    execute: async (raw: unknown) => {
      const loose = ProposeSchema.safeParse(raw);
      if (!loose.success) return `Invalid input: ${loose.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`;
      const p = loose.data;
      const materialId = p.materialId ?? (await myUnfiled(ctx))[0]?.id;
      if (!materialId) return "No uploaded file is waiting to be filed. Ask the person to attach one first.";
      const targets = (await attachTargets(ctx)).filter((t) => t.subjectId === p.subjectId && (!p.gradeId || t.gradeId === p.gradeId));
      if (targets.length !== 1) return targets.length ? "That subject is taught in several grades; give gradeId too." : "That subject is not one this person can file into. Use one from their list.";
      const target = targets[0]!;
      const parsed = AttachMaterialSchema.safeParse({
        materialId,
        gradeId: target.gradeId,
        subjectId: target.subjectId,
        ...(p.unitId ? { unitId: p.unitId } : {}),
        share: p.share ?? (role === "student" ? "private" : "class"),
        ...(p.title ? { title: p.title } : {}),
      });
      if (!parsed.success) return `Invalid input: ${parsed.error.issues.map((i) => i.message).join("; ")}`;
      const input = parsed.data;
      if (role === "student" && input.share === "class") return "Students cannot share with the class directly; use share 'suggest' or 'private'.";
      if (role === "teacher" && input.share === "suggest") return "Teachers share with 'class' or keep it 'private'.";
      const supabase = await createClient();
      const { data: material, error } = await supabase
        .from("curriculum_materials")
        .select("id, title, subject_id, created_by")
        .eq("id", input.materialId)
        .eq("institution_id", ctx.institution.id)
        .maybeSingle();
      if (error || !material || material.created_by !== ctx.user.id) return "That file id is not one of this person's uploads.";
      const unit = input.unitId ? target.units.find((u) => u.id === input.unitId) : undefined;
      if (input.unitId && !unit) return "That unit is not in this subject. Leave unitId out or pick one from the list.";
      const where = [target.gradeName, target.subjectName, unit?.title].filter(Boolean).join(" · ");
      return {
        kind: "action_draft" as const,
        action: "curriculum.material.attach",
        input,
        summary: `Attach "${input.title ?? material.title}" to ${where}, ${SHARE_LABEL[input.share]}`,
      };
    },
  });
}
