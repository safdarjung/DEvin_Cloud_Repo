// Tool budget (gateway layer): a chat request never carries the whole tool
// registry. Deterministic and dependency-free: keyword/synonym match of the
// latest user message(s) against each tool group's label, description and
// tool names; a tiny core set always rides along; old history is trimmed
// before tools. Token counts are estimates: chars/4 of the JSON or text
// actually sent (system prompt, tool name+description+JSON schema, messages).
import { asSchema, tool, type ModelMessage, type PrepareStepFunction, type ToolSet } from "ai";
import { z } from "zod";

export const CHARS_PER_TOKEN = 4;

/**
 * Per-request prompt ceiling (system + tools + messages, estimated), per
 * provider, comfortably under each provider's own limit:
 * - groq: free tier allows 8,000 tokens per minute and counts max_tokens
 *   (1,024) in each request, so 5,500 leaves room for both.
 * - gemini: free-tier TPM is far larger; 24,000 keeps latency sane.
 * - local: Ollama's default context is 4,096 tokens and silently drops the
 *   start of a longer prompt (the system rules) — shortcut: assumes the
 *   default num_ctx; raise this if the school runs Ollama with a larger one.
 */
export const TOKEN_CEILING = { groq: 5_500, gemini: 24_000, local: 3_500 } as const;
export type BudgetProvider = keyof typeof TOKEN_CEILING;

/** Room kept free on the first step for one tool result (agents/tools.ts MAX_TOOL_RESULT_CHARS) plus the call. */
export const RESULT_RESERVE_TOKENS = 1_100;
/** Matched groups per request; more relevant tools rarely help a small model and crowd out history. */
export const MAX_GROUPS = 3;
/** Vague questions ("hello") get the first catalog groups up to this many tool tokens. */
export const FALLBACK_TOOL_TOKENS = 1_200;
/**
 * A tool set this small goes whole (agent runs, a student's few tools). Kept
 * well under the ceiling on purpose: Groq's 8,000 TPM covers every step of an
 * answer within the minute, so a 2-step answer must stay near 3,000 a step.
 */
export const WHOLE_SET_TOKENS = 1_500;
/** Times the model may load another group within one answer. */
export const MAX_GROUP_LOADS = 2;
export const META_TOOL = "more_tools";

export interface ToolGroup {
  key: string;
  label: string;
  description: string;
  /** Tool names in this group (a tool may sit in several groups). */
  tools: readonly string[];
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function ceilingFor(providers: readonly BudgetProvider[]): number {
  return Math.min(...providers.map((p) => TOKEN_CEILING[p]));
}

/** Name + description + JSON schema, the shape every provider receives. */
export function toolTokens(name: string, def: ToolSet[string]): number {
  const schema = (def as { inputSchema?: unknown }).inputSchema;
  const parameters = schema ? asSchema(schema as never).jsonSchema : {};
  return estimateTokens(JSON.stringify({ name, description: (def as { description?: string }).description ?? "", parameters }));
}

export function messagesTokens(messages: readonly ModelMessage[]): number {
  return estimateTokens(JSON.stringify(messages));
}

// ---- matching ---------------------------------------------------------------

const STOP_WORDS = new Set(
  "a an and are as at be by can could do does for from get give had has have how i in is it me my of on or our please show tell that the their them there these this to us was we were what when where which who why will with you your".split(" "),
);

// Everyday words → the words the catalog uses for that domain.
const SYNONYMS: Readonly<Record<string, string>> = {
  absent: "attendance", absence: "attendance", absentee: "attendance", present: "attendance", late: "attendance",
  bunk: "attendance", missing: "attendance", attend: "attendance",
  fee: "finance fee invoice", due: "finance fee invoice", unpaid: "finance invoice defaulter", paid: "finance invoice",
  pay: "finance invoice", payment: "finance invoice", dues: "finance fee", defaulter: "finance defaulter",
  outstanding: "finance outstanding", collection: "finance collection", money: "finance fee expense", balance: "finance invoice",
  instalment: "finance instalment", installment: "finance instalment", tuition: "finance fee",
  exam: "exam result", test: "exam result", mark: "exam result grade", score: "exam result grade", result: "exam result",
  grade: "exam grade", topper: "exam result", fail: "exam result", report: "exam result",
  timetable: "timetable schedule", period: "timetable", schedule: "timetable", clash: "timetable conflict",
  substitute: "timetable substitution cover", cover: "timetable substitution",
  admission: "admissions enquiry", enquiry: "admissions enquiry", inquiry: "admissions enquiry", applicant: "admissions application",
  lead: "admissions enquiry", funnel: "admissions funnel",
  teacher: "staff teacher", staff: "staff", employee: "staff", leave: "leave staff",
  student: "student", child: "student", kid: "student", pupil: "student", son: "student", daughter: "student",
  homework: "homework diary assignment", diary: "diary homework", assignment: "assignment submission",
  syllabus: "curriculum unit", chapter: "curriculum unit", topic: "curriculum unit", lesson: "lesson curriculum unit",
  weak: "mastery gap weak", mastery: "mastery gap", risk: "risk insight", forecast: "forecast insight",
  holiday: "calendar event", event: "calendar event", notice: "notice announcement", circular: "notice announcement",
  announce: "announcement", quiz: "quiz", remark: "remark", worksheet: "worksheet", paper: "question paper",
  book: "library book", library: "library", bus: "transport", visitor: "visitor gate", hostel: "hostel room",
  canteen: "canteen", stock: "inventory stock", club: "club house", house: "house club", alumni: "alumni",
  salary: "payroll", payroll: "payroll", expense: "expense", budget: "expense budget", ticket: "helpdesk ticket",
  complaint: "helpdesk ticket", form: "form", lab: "lab", achievement: "achievement", award: "achievement",
  duty: "duty roster", safety: "safety alert", alert: "safety alert", behaviour: "behaviour point", behavior: "behaviour point",
  merit: "behaviour point", concession: "concession scholarship", scholarship: "concession scholarship",
  workflow: "workflow automation", approval: "approval pending", page: "navigate link", where: "navigate link", open: "navigate link",
  link: "navigate link", task: "task follow", certificate: "certificate", seat: "seating exam",
  attached: "attach file upload", uploaded: "upload file attach", pdf: "file upload",
};

function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith("es") && !word.endsWith("ses")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** Lower-case word stems, camelCase/snake_case/dotted names split. */
export function terms(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
    .map(stem);
}

function queryTerms(text: string): string[] {
  const out = new Set<string>();
  for (const t of terms(text)) {
    out.add(t);
    for (const s of terms(SYNONYMS[t] ?? "")) out.add(s);
  }
  return [...out];
}

/** Per group: 2 per query term in its label/key/tool names, 1 in its description, each divided by how many groups share the term (rare words decide). */
function groupScores(groups: readonly ToolGroup[], query: readonly string[]): number[] {
  const vocab = groups.map((g) => ({
    strong: new Set(terms(`${g.label} ${g.key} ${g.tools.join(" ")}`)),
    weak: new Set(terms(g.description)),
  }));
  const df = (t: string) => vocab.filter((v) => v.strong.has(t) || v.weak.has(t)).length || 1;
  return vocab.map((v) => query.reduce((sum, t) => sum + (v.strong.has(t) ? 2 : v.weak.has(t) ? 1 : 0) / df(t), 0));
}

/** A group joins the pick only when it scores at least this share of the best group. */
const MIN_SHARE_OF_BEST = 0.4;

// ---- selection ----------------------------------------------------------------

export interface SelectToolsInput {
  /** Every tool the caller may use (already permission/module gated). */
  tools: ToolSet;
  groups: readonly ToolGroup[];
  /** Always kept when present (and when they fit). */
  core: readonly string[];
  /** Latest user message first, then older ones; earlier entries weigh more. */
  texts: readonly string[];
  /** Tokens available for tool definitions. */
  budget: number;
  /**
   * Required id field -> tools that look such ids up (e.g. termId -> the term
   * list). A picked tool that requires the field brings its lookup along, so
   * a group never arrives without the way to fill its inputs.
   */
  idProviders?: Readonly<Record<string, readonly string[]>>;
}

export interface ToolSelection {
  active: string[];
  /** Group keys chosen, best first. */
  groups: string[];
  tokens: number;
  matched: boolean;
}

function requiredFields(def: ToolSet[string] | undefined): string[] {
  const schema = (def as { inputSchema?: unknown } | undefined)?.inputSchema;
  if (!schema) return [];
  const required = (asSchema(schema as never).jsonSchema as { required?: unknown }).required;
  return Array.isArray(required) ? required.filter((f): f is string => typeof f === "string") : [];
}

/** Deterministic: same input, same subset. Groups ranked by match; ties keep catalog order. */
export function selectTools(input: SelectToolsInput): ToolSelection {
  const { tools, groups, core, texts, budget, idProviders = {} } = input;
  const cost = new Map(Object.entries(tools).map(([name, def]) => [name, toolTokens(name, def)]));
  const active: string[] = [];
  let tokens = 0;
  const add = (name: string): boolean => {
    if (active.includes(name)) return true;
    const c = cost.get(name);
    if (c === undefined || tokens + c > budget) return false;
    active.push(name);
    tokens += c;
    for (const field of requiredFields(tools[name])) for (const provider of idProviders[field] ?? []) add(provider);
    return true;
  };
  for (const name of core) add(name);

  const perText = texts.map((text, i) => ({ scores: groupScores(groups, queryTerms(text)), weight: i === 0 ? 2 : 1 }));
  const scored = groups.map((group, index) => ({ group, index, score: perText.reduce((s, t) => s + t.weight * (t.scores[index] ?? 0), 0) }));
  const best = Math.max(0, ...scored.map((r) => r.score));
  const ranked = scored
    .filter((r) => r.score > 0 && r.score >= best * MIN_SHARE_OF_BEST && r.group.tools.length > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const chosen: string[] = [];
  for (const { group } of ranked) {
    if (chosen.length >= MAX_GROUPS) break;
    const before = active.length;
    for (const name of group.tools) add(name);
    if (active.length > before) chosen.push(group.key);
  }
  if (chosen.length > 0) return { active, groups: chosen, tokens, matched: true };

  // Vague question: the first catalog groups (the commonest domains) up to a small cap.
  const cap = Math.min(budget, tokens + FALLBACK_TOOL_TOKENS);
  for (const group of groups) {
    if (chosen.length >= MAX_GROUPS) break;
    const fits = group.tools.reduce((s, n) => s + (active.includes(n) ? 0 : cost.get(n) ?? 0), 0);
    if (group.tools.length === 0 || tokens + fits > cap) continue;
    group.tools.forEach(add);
    chosen.push(group.key);
  }
  return { active, groups: chosen, tokens, matched: false };
}

/** Drops the oldest messages until the rest fit; the latest message always stays. Never starts on an assistant turn. */
export function trimHistory(messages: readonly ModelMessage[], budget: number): ModelMessage[] {
  let start = 0;
  while (start < messages.length - 1 && messagesTokens(messages.slice(start)) > budget) start++;
  while (start < messages.length - 1 && messages[start]?.role !== "user") start++;
  return messages.slice(start);
}

// ---- request plan + recovery ---------------------------------------------------

/** What a caller tells the gateway about its tools; the gateway picks the subset. */
export interface ToolBudgetHints {
  /** Omitted: one group per tool (agent runs, whose tool sets are small). */
  groups?: readonly ToolGroup[];
  core?: readonly string[];
  idProviders?: SelectToolsInput["idProviders"];
  /** Latest user text first. */
  texts: readonly string[];
}

export interface BudgetInput<TOOLS extends ToolSet> extends ToolBudgetHints {
  system: string;
  messages: ModelMessage[];
  tools: TOOLS;
  ceiling: number;
}

// TOOLS plus `more_tools` at runtime; typed as TOOLS so callers keep their stream's tool types.
export interface BudgetPlan<TOOLS extends ToolSet> {
  messages: ModelMessage[];
  tools: TOOLS;
  activeTools: Array<keyof TOOLS & string>;
  prepareStep: PrepareStepFunction<TOOLS>;
  /** Estimated first-step prompt tokens (system + active tools + messages). */
  estimatedTokens: number;
  groups: string[];
}

/**
 * The request a chat/agent stream actually sends: a relevant tool subset, the
 * history trimmed to fit, and `more_tools` so a wrong first pick can recover —
 * it lists the other groups, and loading one swaps it in for the next step,
 * evicting earlier picks so every step stays under `ceiling`.
 */
export function planToolBudget<TOOLS extends ToolSet>(input: BudgetInput<TOOLS>): BudgetPlan<TOOLS> {
  const { system, tools, ceiling } = input;
  const groups = input.groups ?? Object.keys(tools).map((name) => ({ key: name, label: name, description: "", tools: [name] }));
  const latest = input.messages.slice(-1);
  const systemTokens = estimateTokens(system);

  const loaded: string[] = [];
  const findGroup = (key: string) => groups.find((g) => g.key === key || g.label.toLowerCase() === key.toLowerCase());
  const meta = tool({
    description: "Only when your tools cannot answer: call with no group to list other tool groups, or with a group key to load it for your next step.",
    inputSchema: z.object({ group: z.string().max(80).optional() }),
    execute: async ({ group }) => {
      if (!group) {
        const rest = groups.filter((g) => !selection.groups.includes(g.key) && !loaded.includes(g.key) && g.tools.length > 0);
        return rest.length ? `Groups: ${rest.map((g) => `${g.key} (${g.label})`).join("; ")}`.slice(0, 2_000) : "No other groups.";
      }
      const found = findGroup(group);
      if (!found || found.tools.length === 0) return "Unknown group. Call more_tools with no group to list them.";
      if (loaded.length >= MAX_GROUP_LOADS) return "No more groups can be loaded for this answer; answer with what you have.";
      if (!loaded.includes(found.key)) loaded.push(found.key);
      return `Loaded ${found.label}: ${found.tools.join(", ")}. Use them in your next step.`;
    },
  });
  const toolBudget = Math.max(ceiling - RESULT_RESERVE_TOKENS - systemTokens - messagesTokens(latest), 0);
  const names = Object.keys(tools);
  const total = names.reduce((s, n) => s + toolTokens(n, tools[n] as ToolSet[string]), 0);
  // Small sets (agent runs, a student's few tools) go whole, no meta-tool needed.
  const fitsWhole = total <= Math.min(toolBudget, WHOLE_SET_TOKENS);
  const allTools: ToolSet = fitsWhole ? { ...tools } : { ...tools, [META_TOOL]: meta };
  const core = fitsWhole ? [] : [META_TOOL, ...(input.core ?? [])];
  const selection: ToolSelection = fitsWhole
    ? { active: names, groups: groups.map((g) => g.key), tokens: total, matched: true }
    : selectTools({ tools: allTools, groups, core, texts: input.texts, budget: toolBudget, idProviders: input.idProviders });
  const messages = trimHistory(input.messages, ceiling - RESULT_RESERVE_TOKENS - systemTokens - selection.tokens);
  const costs = new Map<string, number>();
  const cost = (name: string): number => {
    if (!costs.has(name)) costs.set(name, allTools[name] ? toolTokens(name, allTools[name]) : 0);
    return costs.get(name) ?? 0;
  };

  // Every step: core + loaded groups (newest first) + first-pick tools, while they fit the ceiling.
  const prepareStep: PrepareStepFunction<ToolSet> = ({ messages: stepMessages }) => {
    let room = ceiling - systemTokens - messagesTokens(stepMessages);
    const loadedTools = [...loaded].reverse().flatMap((k) => findGroup(k)?.tools ?? []);
    // A loaded group brings its id lookups too, same as a first pick.
    const withLookups = loadedTools.flatMap((n) => [n, ...requiredFields(allTools[n]).flatMap((f) => input.idProviders?.[f] ?? [])]);
    const order = [...core, ...withLookups, ...selection.active];
    const active: string[] = [];
    for (const name of order) {
      if (active.includes(name) || !(name in allTools) || cost(name) > room) continue;
      active.push(name);
      room -= cost(name);
    }
    return { activeTools: active };
  };

  return {
    messages,
    tools: allTools as TOOLS,
    activeTools: selection.active,
    prepareStep: prepareStep as unknown as PrepareStepFunction<TOOLS>,
    estimatedTokens: systemTokens + selection.tokens + messagesTokens(messages),
    groups: selection.groups,
  };
}
