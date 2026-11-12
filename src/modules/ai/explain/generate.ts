import "server-only";
// /anatomy, /teardown, /infographic, /mindmap, /diagram, /image. One gateway call each (runStructured:
// permission, quota, rate, concurrency, usage row, cloud redaction). The
// prompt is only the topic the person typed, so the owner cloud exception
// applies (agentCloud, like study-generate). A photo or PDF goes through the
// study studio's own file path: file-reading consent, fileSource (ownership
// under RLS, 10 MB, magic bytes) and runStructuredFile (Gemini, neutral file
// name). Persists nothing: the answer is a suggestion on screen (rule 6).
import { fail, ok, type ActionResult } from "@/lib/actions/result";
import { runImage, runStructured, runStructuredFile, runWebSearch } from "@/lib/ai/gateway";
import { browseResources } from "@/modules/resources/queries";
import { unitSearchWords, unitTitleScore } from "@/modules/ai/agent/unit-match";
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { hasFileReadingConsent } from "@/modules/study/generate";
import { fileSource } from "@/modules/study/help-sources";
import { webResourcesPrompt, anatomyInstructions, anatomyPrompt, fileAskInstructions, fileAskPrompt, flashcardsInstructions, flowInstructions, lessonPlanInstructions, lessonPlanPrompt, imagePrompt, infographicInstructions, infographicPrompt, mindMapInstructions, visualPrompt } from "./prompts";
import {
  AnatomyGenerationSchema,
  FileAnswerGenerationSchema,
  groundedResources,
  type LessonResource,
  type LessonResourcesRequest,
  type LessonResourcesResponse,
  FlashcardsGenerationSchema,
  LessonPlanGenerationSchema,
  toLessonPlanDoc,
  type LessonPlanRequest,
  type LessonPlanResponse,
  toFlashcards,
  type FlashcardsResponse,
  toFileAnswer,
  type FileAnswerResponse,
  type FileAskRequest,
  FlowGenerationSchema,
  InfographicGenerationSchema,
  MindMapGenerationSchema,
  blockedPicture,
  blockedTopic,
  clip,
  toAnatomy,
  toFlow,
  toInfographic,
  toMindMap,
  type AnatomyRequest,
  type AnatomyResponse,
  type DiagramResponse,
  type ImageRequest,
  type ImageResponse,
  type InfographicRequest,
  type InfographicResponse,
  type MindMapResponse,
  type VisualRequest,
} from "./schemas";

// lesson 9: always cap output.
const ANATOMY_TOKENS = { simple: 1500, standard: 2500, deep: 4000 } as const;
const INFOGRAPHIC_TOKENS = 3000;
const MINDMAP_TOKENS = 2000;
const FLOW_TOKENS = 1600;

const base = (ctx: TenantContext) => ({
  ctx,
  permission: "ai.chat" as const,
  denyNames: ctx.user.profile.fullName ? [ctx.user.profile.fullName] : [],
});

const CONSENT_NEEDED = "Tick the box to agree that your file is sent to the school's AI provider to be read.";

/** The file the person picked, read under their own access: consent first, then ownership (RLS), size and type checks. */
async function readableFile(ctx: TenantContext, materialId: string): Promise<ActionResult<NonNullable<Awaited<ReturnType<typeof fileSource>>["file"]>>> {
  if (!(await hasFileReadingConsent(ctx))) return fail("validation_failed", CONSENT_NEEDED, { consent: ["Required the first time"] });
  const source = await fileSource(await createClient(), ctx, materialId, ctx.membership.role === "student" ? "student" : "teacher");
  return source.file ? ok(source.file) : fail("not_found", "That file was not found.");
}

export async function explainAnatomy(ctx: TenantContext, input: AnatomyRequest): Promise<ActionResult<AnatomyResponse>> {
  const blocked = blockedTopic(input.subject);
  if (blocked) return ok({ refused: true, reason: blocked });

  const call = {
    ...base(ctx),
    feature: "explain_anatomy",
    schema: AnatomyGenerationSchema,
    instructions: anatomyInstructions(input),
    prompt: anatomyPrompt(input.subject, input.documentId !== undefined),
    maxOutputTokens: ANATOMY_TOKENS[input.depth],
  };
  let generated;
  if (input.documentId) {
    if (!(await hasFileReadingConsent(ctx))) {
      return fail("validation_failed", "Tick the box to agree that your file is sent to the school's AI provider to be read.", { consent: ["Required the first time"] });
    }
    const source = await fileSource(await createClient(), ctx, input.documentId, ctx.membership.role === "student" ? "student" : "teacher");
    if (!source.file) return fail("not_found", "That file was not found.");
    generated = await runStructuredFile({ ...call, file: source.file });
  } else {
    generated = await runStructured({ ...call, agentCloud: true });
  }
  if (!generated.ok) return generated;

  const { data, provider, model } = generated.data;
  if (data.refusal.trim()) return ok({ refused: true, reason: clip(data.refusal, 300) });
  const anatomy = toAnatomy(data);
  if (!anatomy) return fail("ai_invalid_output", "The explanation came back incomplete. Try again, or name the thing more clearly.");
  return ok({ refused: false, mode: input.mode, depth: input.depth, language: input.language, anatomy, provider, model });
}

export async function makeInfographic(ctx: TenantContext, input: InfographicRequest): Promise<ActionResult<InfographicResponse>> {
  const generated = await runStructured({
    ...base(ctx),
    feature: "infographic",
    schema: InfographicGenerationSchema,
    instructions: infographicInstructions(input),
    prompt: infographicPrompt(input.topic, input.fromAnatomy),
    maxOutputTokens: INFOGRAPHIC_TOKENS,
    agentCloud: true,
  });
  if (!generated.ok) return generated;

  const { data, provider, model } = generated.data;
  if (data.refusal.trim()) return ok({ refused: true, reason: clip(data.refusal, 300) });
  const infographic = toInfographic(data);
  if (!infographic) return fail("ai_invalid_output", "The poster came back with too few usable panels. Try again.");
  return ok({ refused: false, infographic, provider, model });
}

export async function makeMindMap(ctx: TenantContext, input: VisualRequest): Promise<ActionResult<MindMapResponse>> {
  const blocked = blockedTopic(input.topic);
  if (blocked) return ok({ refused: true, reason: blocked });
  const call = { ...base(ctx), feature: "mindmap", schema: MindMapGenerationSchema, instructions: mindMapInstructions(input), prompt: visualPrompt(input.topic, Boolean(input.materialId)), maxOutputTokens: MINDMAP_TOKENS };
  const file = input.materialId ? await readableFile(ctx, input.materialId) : null;
  if (file && !file.ok) return file;
  const generated = file ? await runStructuredFile({ ...call, file: file.data }) : await runStructured({ ...call, agentCloud: true });
  if (!generated.ok) return generated;

  const { data, provider, model } = generated.data;
  if (data.refusal.trim()) return ok({ refused: true, reason: clip(data.refusal, 300) });
  const mindmap = toMindMap(data);
  if (!mindmap) return fail("ai_invalid_output", "The mind map came back with too few branches. Try again, or name the topic more clearly.");
  return ok({ refused: false, mindmap, provider, model });
}

export async function makeDiagram(ctx: TenantContext, input: VisualRequest): Promise<ActionResult<DiagramResponse>> {
  const blocked = blockedTopic(input.topic);
  if (blocked) return ok({ refused: true, reason: blocked });
  const call = { ...base(ctx), feature: "diagram", schema: FlowGenerationSchema, instructions: flowInstructions(input), prompt: visualPrompt(input.topic, Boolean(input.materialId)), maxOutputTokens: FLOW_TOKENS };
  const file = input.materialId ? await readableFile(ctx, input.materialId) : null;
  if (file && !file.ok) return file;
  const generated = file ? await runStructuredFile({ ...call, file: file.data }) : await runStructured({ ...call, agentCloud: true });
  if (!generated.ok) return generated;

  const { data, provider, model } = generated.data;
  if (data.refusal.trim()) return ok({ refused: true, reason: clip(data.refusal, 300) });
  const flow = toFlow(data);
  if (!flow) return fail("ai_invalid_output", "The diagram came back with too few joined steps. Try again, or name the process more clearly.");
  return ok({ refused: false, flow, provider, model });
}

export async function makeFlashcards(ctx: TenantContext, input: VisualRequest): Promise<ActionResult<FlashcardsResponse>> {
  const blocked = blockedTopic(input.topic);
  if (blocked) return ok({ refused: true, reason: blocked });
  const call = { ...base(ctx), feature: "flashcards", schema: FlashcardsGenerationSchema, instructions: flashcardsInstructions(input), prompt: visualPrompt(input.topic, Boolean(input.materialId)), maxOutputTokens: 1800 };
  const file = input.materialId ? await readableFile(ctx, input.materialId) : null;
  if (file && !file.ok) return file;
  const generated = file ? await runStructuredFile({ ...call, file: file.data }) : await runStructured({ ...call, agentCloud: true });
  if (!generated.ok) return generated;
  const { data, provider, model } = generated.data;
  if (data.refusal.trim()) return ok({ refused: true, reason: clip(data.refusal, 300) });
  const flashcards = toFlashcards(data);
  if (!flashcards) return fail("ai_invalid_output", "The deck came back with too few cards. Try again, or name the topic more clearly.");
  return ok({ refused: false, flashcards, provider, model });
}

export async function makeImage(ctx: TenantContext, input: ImageRequest): Promise<ActionResult<ImageResponse>> {
  const blocked = blockedPicture(input.prompt);
  if (blocked) return ok({ refused: true, reason: blocked });
  const drawn = await runImage({ ...base(ctx), feature: "image", prompt: imagePrompt(input.prompt) });
  if (!drawn.ok) return drawn;
  const { base64, mediaType, provider, model } = drawn.data;
  return ok({ refused: false, prompt: input.prompt, image: { base64, mediaType }, provider, model });
}

export async function askFile(ctx: TenantContext, input: FileAskRequest): Promise<ActionResult<FileAnswerResponse>> {
  const file = await readableFile(ctx, input.materialId);
  if (!file.ok) return file;
  const generated = await runStructuredFile({
    ...base(ctx),
    feature: "file_ask",
    schema: FileAnswerGenerationSchema,
    instructions: fileAskInstructions(input),
    prompt: fileAskPrompt(input),
    maxOutputTokens: 1400,
    file: file.data,
  });
  if (!generated.ok) return generated;
  const { data, provider, model } = generated.data;
  if (data.refusal.trim()) return ok({ refused: true, reason: clip(data.refusal, 300) });
  const result = toFileAnswer(data);
  if (!result) return fail("ai_invalid_output", "The answer came back empty. Try asking in other words.");
  return ok({ refused: false, fileName: file.data.fileName, action: input.action, result, provider, model });
}

/** Teachers and school staff only: a lesson plan is teaching material, not study help. */
export async function makeLessonPlan(ctx: TenantContext, input: LessonPlanRequest): Promise<ActionResult<LessonPlanResponse>> {
  if (ctx.membership.role === "student" || ctx.membership.role === "guardian") return fail("forbidden", "Lesson plans are for teachers.");
  const blocked = blockedTopic(input.request);
  if (blocked) return ok({ refused: true, reason: blocked });
  const generated = await runStructured({
    ...base(ctx),
    feature: "lesson_plan_doc",
    schema: LessonPlanGenerationSchema,
    instructions: lessonPlanInstructions(input),
    prompt: lessonPlanPrompt(input.request),
    maxOutputTokens: 3200,
    agentCloud: true,
  });
  if (!generated.ok) return generated;
  const { data, provider, model } = generated.data;
  if (data.refusal.trim()) return ok({ refused: true, reason: clip(data.refusal, 300) });
  const plan = toLessonPlanDoc(data);
  if (!plan) return fail("ai_invalid_output", "The lesson plan came back incomplete. Try again, or name the chapter and class.");
  return ok({ refused: false, plan, provider, model });
}

/**
 * Resources for a lesson: the school's own (Resources page, under the caller's RLS) ranked by how well
 * their title, unit and description match the topic, or the web through Google-grounded search.
 */
export async function findLessonResources(ctx: TenantContext, input: LessonResourcesRequest): Promise<ActionResult<LessonResourcesResponse>> {
  if (ctx.membership.role === "student" || ctx.membership.role === "guardian") return fail("forbidden", "Lesson resources are for teachers.");
  const blocked = blockedTopic(input.topic);
  if (blocked) return ok({ resources: [], note: blocked });
  if (input.source === "school") {
    const words = unitSearchWords(input.topic);
    const rows = await browseResources(ctx);
    const slug = ctx.institution.slug;
    const resources: LessonResource[] = rows
      .map((r) => ({ r, score: unitTitleScore(`${r.title} ${r.unitTitle ?? ""} ${r.description ?? ""}`, words) }))
      .filter((x) => x.score >= 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(({ r }) => ({
        title: r.title,
        url: r.url ?? `/${slug}/resources`,
        kind: r.kind,
        why: [r.subjectName, r.unitTitle].filter(Boolean).join(" · ") || "From your school's resources",
        source: "school" as const,
      }));
    return ok({ resources, note: resources.length ? "" : "No resource on the school's Resources page matches this topic yet. Try the internet, or add one on the Resources page." });
  }
  const searched = await runWebSearch({ ...base(ctx), feature: "lesson_resources_web", prompt: webResourcesPrompt(input.topic, input.classLabel) });
  if (!searched.ok) return searched;
  const resources = groundedResources(searched.data.text, searched.data.sources);
  return ok({ resources, note: resources.length ? "Found by a Google search. Open each one and check it before class." : "The search found nothing that could be checked. Try again or name the chapter differently." });
}
