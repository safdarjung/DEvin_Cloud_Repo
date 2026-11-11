import "server-only";
// T4 (ai-roles) — the one chat-request handler every `/api/ai/agent/*`
// route now delegates to (CLAUDE.md "Persona from ctx.membership.role,
// never the route; all 3 routes become the same handler"). Replaces the
// assistant/teacher/student routes' own copies of the cross-site/body/
// schema guard, tenant-context resolution, and error mapping with one
// copy; persona, tool scoping, and the local/cloud choice all come from
// the caller's role and `institutions.settings.ai_roles` (T1b's
// resolver), not from which URL was called.
import { convertToModelMessages, stepCountIs, type ToolSet, type UIMessage } from "ai";
import { z } from "zod";
import { AppError, fail, type ActionResult } from "@/lib/actions/result";
import { apiResponse } from "@/lib/http/api-envelope";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { hasPermission, type Role } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import { isCrossSiteRequest, readJsonBody } from "@/lib/http/request";
import { uuid } from "@/lib/schemas/common";
import { AI_ROLES } from "@/modules/core/schemas";
import { UIMessageRequestSchema, latestUserText, stripToText } from "@/lib/ai/ui-message-schema";
import { redact } from "@/lib/ai/redact";
import { streamChat } from "@/lib/ai/gateway";
import { pickAgentProvider } from "@/modules/ai/agent/provider-routing";
import { buildReadTools, toolNameFor } from "@/modules/agents/tools";
import type { ToolGroup } from "@/lib/ai/tool-budget";
import { buildDraftTools } from "@/modules/ai/kernel/draft-tools";
import { ASSISTANT_CATALOG_VERSION, ASSISTANT_QUERIES, createSourceLog } from "@/modules/ai/assistant/catalog";
import { createTaskTool, navigateTool } from "@/modules/ai/assistant/tools";
import { teacherTools } from "@/modules/ai/agent/teacher-tools";
import { studentTools } from "@/modules/ai/agent/student-tools";
import { getStudentPreferences } from "@/modules/ai/student-preferences";
import { listMyChildren } from "@/modules/people/queries";
import { CAPABILITIES, type CapabilityKey } from "@/modules/ai/capabilities/catalog";
import { enabledCapabilities, previewEnabledCapabilities, roleAiConfig } from "@/modules/ai/capabilities/resolve";
import { systemPromptFor } from "@/modules/ai/kernel/personas";
import { FILE_ATTACH_GROUP, FILE_ATTACH_TOOL, fileAttachTool } from "@/modules/textbooks/ai-attach-tool";
import { scopedChatExtras } from "@/modules/study/scope-chat";
import { buildTaskTools, withTaskTools } from "@/modules/ai/tasks/task-tools";
import { ORB_MODES, TASK_KEY_RE } from "@/modules/core/control-centre/ids";

const MAX_BODY_BYTES = 64 * 1024;

const ChatRequestSchema = z
  .object({
    institutionSlug: z.string().trim().min(1).max(100),
    messages: z.array(UIMessageRequestSchema).min(1).max(50),
    studentId: uuid.optional(),
    // 0140: a student's saved "study with AI" scope (study_items id; re-read under RLS).
    scopeId: uuid.optional(),
    // T7 — "Test as role" in settings/ai: an `institution.settings.manage`
    // holder previews another role's persona/capabilities while still
    // running as themselves (own RLS, own permissions). Checked below, not
    // here — a bad enum value is just validation_failed either way.
    previewRole: z.enum(AI_ROLES).optional(),
    // Orb task bridge: the orb tab the person is in, and a task they clicked (checked against taskState).
    mode: z.enum(ORB_MODES).optional(),
    taskHint: z.string().regex(TASK_KEY_RE).optional(),
  })
  .passthrough();

// Preserves each existing route's own `ai_usage_events.feature` value
// (student's own per-feature quota check in usage.ts keys off
// "student_study" by name) — guardian is new, gets its own bucket.
const FEATURE_BY_ROLE: Partial<Record<Role, string>> = {
  student: "student_study",
  teacher: "teacher_agent",
  guardian: "guardian_chat",
};

function featureFor(role: Role): string {
  return FEATURE_BY_ROLE[role] ?? "assistant";
}

function mapTenantContextError(err: unknown): ActionResult<never> | null {
  const digest = (err as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string") return null;
  if (digest.startsWith("NEXT_REDIRECT")) return fail("unauthenticated", "Sign in required.");
  if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")) return fail("not_found", "Institution not found.");
  return null;
}

function internalError(correlationId: string): ActionResult<never> {
  return fail("internal", `Something went wrong. Reference: ${correlationId}`);
}

// Same redaction shape as the old assistant route's own `redactUserText`
// (07 §5 L2-02): every text part, not just the latest turn, since an
// earlier local-provider turn can carry real PII into history that a
// later turn resends verbatim once it routes to cloud.
function redactMessageText(messages: UIMessage[]): { messages: UIMessage[]; redactions: number } {
  let redactions = 0;
  const redacted = messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (part.type !== "text") return part;
      const result = redact(part.text);
      redactions += result.count;
      return { ...part, text: result.text };
    }),
  }));
  return { messages: redacted as UIMessage[], redactions };
}

type ScopedExtras = Awaited<ReturnType<typeof scopedChatExtras>>;

// 07 §5: a study scope's system block and tool description carry the
// student's own free text (the goal, file titles), so on the cloud path they
// get the same redaction as message text.
function redactScoped(scoped: ScopedExtras): { scoped: ScopedExtras; redactions: number } {
  const system = redact(scoped.system);
  let redactions = system.count;
  const tools = Object.fromEntries(
    Object.entries(scoped.tools).map(([name, t]) => {
      if (typeof t.description !== "string") return [name, t];
      const description = redact(t.description);
      redactions += description.count;
      return [name, { ...t, description: description.text }];
    }),
  ) as ToolSet;
  return { scoped: { ...scoped, system: system.text, tools }, redactions };
}

// Guardian defense in depth: RLS already scopes these registry queries to
// the guardian's own children, but the model is never given a free-form
// `studentId` to begin with — every call is rebound to the one verified
// child before it reaches the query, regardless of what the model sent.
function bindStudentId(tools: ToolSet, studentId: string): ToolSet {
  const bound: Record<string, unknown> = {};
  for (const [name, toolDef] of Object.entries(tools)) {
    const execute = (toolDef as { execute?: (input: unknown, ...rest: unknown[]) => unknown }).execute;
    bound[name] =
      typeof execute === "function"
        ? {
            ...toolDef,
            // Pin only tools that take a student id: strict action schemas
            // without one (messaging.send) would reject an added key.
            execute: (input: unknown, ...rest: unknown[]) => {
              const fields = input as Record<string, unknown>;
              return execute("studentId" in fields ? { ...fields, studentId } : fields, ...rest);
            },
          }
        : toolDef;
  }
  return bound as ToolSet;
}

// Data rule on cloud (ai-roles tasks.md "Shared model"): a staff read-group
// query goes to a cloud provider only when ASSISTANT_QUERIES marks it
// aggregate (today's `queriesFor` behavior); a guardian's own-child query
// (`cap.data === "own"`) is allowed regardless — it is one person's own
// record, the same rule that lets the student/guardian "own" capabilities
// through elsewhere.
function queryAllowedOnCloud(name: string, cap: { data: string }): boolean {
  return cap.data === "own" || ASSISTANT_QUERIES[name]?.aggregate === true;
}

// Tool budget: in-app links ride on every request; a picked tool that
// requires one of these ids brings the tool that looks it up (a fees
// question needs the term list, a student question the student search).
export const CORE_TOOLS = ["navigate"];
export const ID_PROVIDERS: Readonly<Record<string, readonly string[]>> = {
  termId: ["exams_listTermOptions"],
  studentId: ["findStudent", "people_listStudents"],
  examId: ["exams_listExams"],
  classSectionId: ["exams_listSectionOptions"],
  sectionId: ["exams_listSectionOptions"],
  subjectId: ["exams_listSubjectOptions"],
  curriculumUnitId: ["findCurriculumUnit", "findMyCurriculumUnit", "academics_listCurriculumUnits"],
};

/** Latest user text first, then the one before (a follow-up like "and 8B?" keeps its topic). */
function recentUserTexts(messages: UIMessage[]): string[] {
  return messages
    .filter((m) => m.role === "user")
    .slice(-2)
    .reverse()
    .map((m) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join(" "));
}

export interface ChatToolsetInput {
  personaRole: Role;
  capabilities: readonly CapabilityKey[];
  mode: "local" | "cloud";
  nonce: string;
  onSource?: (query: string, params: unknown) => void;
  /** Guardian only: every tool's studentId is pinned to this verified child. */
  childId?: string;
  /** Recent user texts: the file-attach draft tool rides along only when they mention an upload. */
  texts?: readonly string[];
}

/**
 * Every chat tool the persona's enabled capabilities allow, plus one group
 * per capability (its label/description and the tool names it contributed)
 * for the gateway's tool budget (`selectTools`). Exported for the
 * full-registry budget test; permission/module gates are the builders' own.
 */
export async function buildChatToolset(ctx: TenantContext, input: ChatToolsetInput): Promise<{ tools: ToolSet; groups: ToolGroup[] }> {
  const { personaRole, capabilities, mode, nonce, onSource, childId } = input;
  const queryCatalog: Record<string, string> = {};
  for (const key of capabilities) {
    const cap = CAPABILITIES[key];
    if (!cap.queries) continue;
    for (const name of cap.queries) {
      if (mode === "cloud" && !queryAllowedOnCloud(name, cap)) continue;
      queryCatalog[name] = ASSISTANT_QUERIES[name]?.description ?? cap.description;
    }
  }
  const { tools: readTools } = await buildReadTools(ctx, queryCatalog, nonce, onSource);
  const draftTools = await buildDraftTools(ctx, capabilities.map((key) => CAPABILITIES[key]));
  let tools: ToolSet = { ...readTools, ...draftTools };
  if (childId) tools = bindStudentId(tools, childId);

  const toolNames = new Set(capabilities.flatMap((key) => CAPABILITIES[key].tools ?? []));
  if (toolNames.has("navigate")) {
    const navigate = navigateTool(ctx);
    if (navigate) tools.navigate = navigate;
  }
  if (toolNames.has("createTask")) {
    const createTask = await createTaskTool(ctx);
    if (createTask) tools.createTask = createTask;
  }
  if (personaRole === "teacher") {
    const allTeacherTools = await teacherTools(ctx);
    for (const [name, toolImpl] of Object.entries(allTeacherTools)) {
      if (toolNames.has(name)) tools[name] = toolImpl;
    }
  }
  if (personaRole === "student") {
    const visualsEnabled = toolNames.has("showStudyBlocks");
    const allStudentTools = (await studentTools(ctx, { visualsEnabled })) as ToolSet;
    for (const [name, toolImpl] of Object.entries(allStudentTools)) {
      if (toolNames.has(name)) tools[name] = toolImpl;
    }
  }

  const groups: ToolGroup[] = capabilities.map((key) => {
    const cap = CAPABILITIES[key];
    const names = [
      ...(cap.queries ?? []).map(toolNameFor),
      ...(cap.tools ?? []),
      ...(cap.drafts ?? []).map((action) => `draft_${toolNameFor(action)}`),
    ];
    return { key, label: cap.label, description: cap.description, tools: [...new Set(names)].filter((name) => name in tools) };
  });
  // 0139: propose where a chat-uploaded file goes (draft only; the person confirms).
  const attach = fileAttachTool(ctx, personaRole, input.texts ?? []);
  if (attach) {
    tools[FILE_ATTACH_TOOL] = attach;
    groups.push(FILE_ATTACH_GROUP);
  }
  return { tools, groups };
}

export async function handleAiChat(request: Request): Promise<Response> {
  if (isCrossSiteRequest(request)) {
    return apiResponse(fail("forbidden", "Cross-site request refused."));
  }

  const bodyResult = await readJsonBody(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    return apiResponse(
      fail("validation_failed", bodyResult.tooLarge ? `Request body exceeds ${MAX_BODY_BYTES / 1024} KB.` : "Request body must be JSON."),
    );
  }

  const parsedRequest = ChatRequestSchema.safeParse(bodyResult.data);
  if (!parsedRequest.success) {
    const { fieldErrors } = parsedRequest.error.flatten();
    return apiResponse(fail("validation_failed", "Invalid input.", fieldErrors as Record<string, string[]>));
  }
  const input = parsedRequest.data;

  let ctx: TenantContext;
  try {
    ctx = await getTenantContext(input.institutionSlug);
  } catch (err) {
    const mapped = mapTenantContextError(err);
    if (mapped) return apiResponse(mapped);
    const correlationId = crypto.randomUUID();
    console.error(`[${correlationId}] handleAiChat failed to resolve tenant context`, err);
    return apiResponse(internalError(correlationId));
  }

  try {
    requirePermission(ctx, "ai.chat");
  } catch (err) {
    if (err instanceof AppError) return apiResponse(fail(err.code, err.message, err.fieldErrors));
    throw err;
  }

  const role = ctx.membership.role;
  const isPreview = input.previewRole !== undefined;
  if (isPreview && !hasPermission(role, "institution.settings.manage")) {
    return apiResponse(fail("forbidden", "You cannot preview another role's AI."));
  }
  // Persona/capabilities/instructions/cloud switch come from the previewed
  // role when previewing; everything else (RLS, permissions, ctx.membership)
  // stays the caller's own — `role` is never reassigned.
  const personaRole: Role = input.previewRole ?? role;

  // School-wide kill switch, kept from the old routes: the AI module off means
  // no chat for anyone it covers, whatever the per-role settings say.
  if (!isModuleEnabled(ctx, personaRole === "student" ? "ai_student" : "ai_teacher")) {
    return apiResponse(fail("ai_unavailable", "AI is switched off for this school."));
  }

  const roleConfig = roleAiConfig(ctx, personaRole);
  if (!roleConfig.enabled) {
    return apiResponse(fail("ai_unavailable", isPreview ? "This AI feature is turned off for that role." : "This AI feature is turned off for your role."));
  }

  let childId: string | undefined;
  if (role === "guardian" && !isPreview) {
    if (!input.studentId) {
      return apiResponse(fail("validation_failed", "A child must be selected.", { studentId: ["Required"] }));
    }
    const children = await listMyChildren(ctx);
    const match = children.find((child) => child.id === input.studentId);
    if (!match) return apiResponse(fail("forbidden", "That student is not one of your children."));
    childId = match.id;
  }

  const strippedMessages = stripToText(input.messages);
  if (strippedMessages.length === 0) {
    return apiResponse(fail("validation_failed", "No readable text in this message."));
  }

  const cloudConfigured = Boolean(process.env.ZAI_API_KEY || process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY);
  const mode: "local" | "cloud" = roleConfig.cloud && cloudConfigured ? "cloud" : "local";
  const provider = mode === "cloud" ? pickAgentProvider(latestUserText(input.messages)) : undefined;

  const capabilities = isPreview
    ? previewEnabledCapabilities(ctx, personaRole, role)
    : enabledCapabilities(ctx, personaRole).filter((key) => CAPABILITIES[key].kind === "chat_tool");

  const nonce = crypto.randomUUID();
  const sources = createSourceLog();
  const { tools, groups } = await buildChatToolset(ctx, { personaRole, capabilities, mode, nonce, onSource: sources.add, childId, texts: recentUserTexts(strippedMessages) });

  // 0140: a student's chosen study scope adds server-built context and one small tool group.
  let scoped: ScopedExtras | null = null;
  let scopedRedactions = 0;
  if (input.scopeId && personaRole === "student" && !isPreview) {
    try {
      scoped = await scopedChatExtras(ctx, input.scopeId);
    } catch (err) {
      if (err instanceof AppError) return apiResponse(fail(err.code, err.message));
      throw err;
    }
    if (mode === "cloud") ({ scoped, redactions: scopedRedactions } = redactScoped(scoped));
  }
  const chatTools: ToolSet = scoped ? { ...tools, ...scoped.tools } : tools;
  const chatGroups = scoped?.group ? [...groups, scoped.group] : groups;
  // Orb task bridge (design §3): approval cards for the caller's enabled tasks; none under role preview.
  const tasks = isPreview
    ? null
    : buildTaskTools({ ctx, nonce, texts: recentUserTexts(strippedMessages), mode: input.mode, taskHint: input.taskHint, childId, readSources: () => sources.list().map((s) => s.query) });
  const taskToolNames = Object.keys(tasks?.tools ?? {});

  const studentPrefs = personaRole === "student" ? await getStudentPreferences(ctx) : undefined;

  const basePrompt = systemPromptFor({
    role: personaRole,
    nonce,
    mode,
    capabilities,
    instructions: roleConfig.instructions,
    studentPrefs: studentPrefs ? { skills: studentPrefs.skills, style: studentPrefs.style } : undefined,
    childId,
  });
  const system = [basePrompt, scoped?.system, tasks?.system].filter(Boolean).join("\n\n");

  const outgoing = mode === "cloud" ? redactMessageText(strippedMessages) : { messages: strippedMessages, redactions: 0 };
  const modelMessages = await convertToModelMessages(outgoing.messages);

  const result = await streamChat({
    ctx,
    feature: isPreview ? "ai_preview" : featureFor(role),
    permission: "ai.chat",
    dataClass: personaRole === "student" ? "student_personal" : "general",
    mode,
    provider,
    system,
    messages: modelMessages,
    tools: tasks ? withTaskTools(chatTools, tasks) : chatTools,
    stopWhen: stepCountIs(personaRole === "student" ? 3 : 6),
    maxOutputTokens: 1024,
    concurrencyKey: personaRole === "student" ? `${ctx.institution.id}:student` : undefined,
    abortSignal: request.signal,
    redactions: outgoing.redactions + scopedRedactions,
    notConfiguredMessage: "The AI chat assistant is not configured. Contact your administrator.",
    budget: { groups: chatGroups, core: [...CORE_TOOLS, ...(scoped?.core ?? []), ...taskToolNames], idProviders: ID_PROVIDERS, texts: recentUserTexts(strippedMessages) },
  });

  if (!result.ok) {
    return apiResponse(fail(result.error.code, result.error.message));
  }

  return result.stream.toUIMessageStreamResponse({
    onError: result.errorText,
    messageMetadata: ({ part }) =>
      part.type === "finish" ? { provider: result.provider, catalogVersion: ASSISTANT_CATALOG_VERSION, sources: sources.list() } : undefined,
  });
}
