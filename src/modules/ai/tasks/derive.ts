// Orb task bridge — defaults derived from registry facts (design §2 "Derived").
// Pure: a catalog row only writes what these rules get wrong.
import { z } from "zod";
import type { ActionMeta } from "@/lib/actions/registry";
import type { ModuleKey } from "@/lib/modules/catalog";
import { ACTION_RISK } from "@/modules/agents/catalog";
import type { OrbGroupId } from "@/modules/ai/components/orb/orb-groups";
import type { ClassifiedRow, ClassifiedTask, EntityRef, EntityType, FieldKind, Rule6Family, TaskMode, TaskRisk } from "./types";

/** A JSON Schema node as z.toJSONSchema emits it for action inputs. */
export interface JsonSchemaNode {
  type?: string;
  format?: string;
  pattern?: string;
  enum?: readonly unknown[];
  properties?: Readonly<Record<string, JsonSchemaNode>>;
  required?: readonly string[];
  items?: JsonSchemaNode;
  anyOf?: readonly JsonSchemaNode[];
  oneOf?: readonly JsonSchemaNode[];
  maxItems?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}

/** One input field: JSON pointer path ("*" for array items), its own name, its schema (nullable unwrapped). */
export interface SchemaField {
  path: string;
  name: string;
  node: JsonSchemaNode;
  required: boolean;
}

/** Same JSON Schema form as GET /api/v1/actions (src/lib/http/dispatch.ts). */
export function actionJsonSchema(meta: Pick<ActionMeta, "schema">): JsonSchemaNode {
  return z.toJSONSchema(meta.schema, { io: "input", unrepresentable: "any" }) as JsonSchemaNode;
}

const branches = (node: JsonSchemaNode): readonly JsonSchemaNode[] => [...(node.anyOf ?? []), ...(node.oneOf ?? [])];

/** The one non-null branch of a nullable union, else the node itself. */
function unwrap(node: JsonSchemaNode): JsonSchemaNode {
  const real = branches(node).filter((b) => b.type !== "null");
  return real.length === 1 ? unwrap(real[0]) : node;
}

/** Every field at every depth; union branches merge into one path (first branch wins). */
export function schemaFields(root: JsonSchemaNode): SchemaField[] {
  const out = new Map<string, SchemaField>();
  const walk = (node: JsonSchemaNode, prefix: string): void => {
    for (const b of branches(node)) walk(b, prefix);
    const required = new Set(node.required ?? []);
    for (const [name, child] of Object.entries(node.properties ?? {})) {
      const path = `${prefix}/${name}`;
      const field = unwrap(child);
      if (!out.has(path)) out.set(path, { path, name, node: field, required: required.has(name) });
      walk(field, path);
      if (field.type === "array" && field.items) walk(unwrap(field.items), `${path}/*`);
    }
  };
  walk(root, "");
  return [...out.values()];
}

// ── groups ────────────────────────────────────────────────────────────────
// Mirror of MODULE_GROUP in orb-groups.ts (not exported, and that file pulls the
// capability catalog). tests/unit/orb-task-derive.test.ts keeps the two equal.
export const MODULE_GROUP: Readonly<Partial<Record<ModuleKey, OrbGroupId>>> = {
  attendance: "attendance", exams: "exams",
  mastery: "teaching", lesson_plans: "teaching", question_bank: "teaching", assignments: "teaching", diary: "teaching",
  ai_teacher: "teaching", practice: "study", ai_student: "study",
  fees: "finance", finance_plus: "finance", expenses: "finance", scholarships: "finance", payroll: "finance",
  admissions: "admissions", timetable: "timetable", people: "people", insights: "insights", ai_briefings: "insights",
  calendar: "calendar", announcements: "calendar", messaging: "calendar", ptm: "calendar", student_leave: "calendar",
  clubs: "clubs", achievements: "clubs", behaviour: "clubs", website: "website",
  hostel: "operations", canteen: "operations", inventory: "operations", helpdesk: "operations", forms: "operations",
  alumni: "operations", school_labs: "operations", resources: "operations", compliance: "operations", duties: "operations",
  safety: "operations", library: "operations", visitors: "operations", workflows: "operations", substitution: "operations",
};

/** The orb group for an action's module; "more" when the module has none. */
export function groupFor(module: ModuleKey | undefined): OrbGroupId {
  return (module && MODULE_GROUP[module]) || "more";
}

// ── risk ──────────────────────────────────────────────────────────────────
const HUMAN_VERB = /^(void|delete|remove|purge|archive|finali[sz]e|publish|close|withdraw|transfer|promote|decide|send)([A-Z_]|$)/;
const LOW_VERB = /^(acknowledge|join|leave|log|toggle)([A-Z_]|$)/;
const LARGE_ARRAY = 50;

const verbOf = (name: string): string => name.slice(name.lastIndexOf(".") + 1);

function hasLargeArray(node: JsonSchemaNode): boolean {
  if (node.type === "array" && (node.maxItems ?? 0) >= LARGE_ARRAY) return true;
  return [...Object.values(node.properties ?? {}), ...branches(node), ...(node.items ? [node.items] : [])].some(hasLargeArray);
}

/** Risk from the verb (last name segment) and array size; ACTION_RISK and the row override it in classify. */
export function deriveRisk(name: string, schema: JsonSchemaNode): TaskRisk {
  const verb = verbOf(name);
  if (HUMAN_VERB.test(verb) || hasLargeArray(schema)) return "human_approved";
  if (LOW_VERB.test(verb)) return "low_risk_reversible";
  return "user_confirmed";
}

const isTaskRisk = (r: string | undefined): r is TaskRisk => r === "low_risk_reversible" || r === "user_confirmed" || r === "human_approved";

// ── mode ──────────────────────────────────────────────────────────────────
const LEARN_MODULES: ReadonlySet<string> = new Set(["ai_student", "practice"]);
const TEACH_MODULES: ReadonlySet<string> = new Set(["assignments", "lesson_plans", "question_bank", "resources", "ai_teacher", "mastery"]);
const SETUP_ENTITY = /type|categor|structure|rule|room|period|setting|slot|instalment|budget|grade|section|subject|department|academicYear|term/i;
const SETUP_VERB = /^(upsert|create|update|set|save|add)$/;
const CREATE_VERB = /^(create|upsert|save)$/;
const CREATE_TEXT: ReadonlySet<string> = new Set(["body", "content", "description", "instructions", "objectives", "remark"]);

/** learn (student study) → manage (setup entity) → create (new content with a text body) → teach (teaching modules) → do. */
export function deriveMode(name: string, module: ModuleKey | undefined, schema: JsonSchemaNode): TaskMode {
  const verb = verbOf(name);
  const entity = name.split(".").slice(1, -1).join(".");
  if (module && LEARN_MODULES.has(module)) return "learn";
  if (entity && SETUP_ENTITY.test(entity) && SETUP_VERB.test(verb)) return "manage";
  if (CREATE_VERB.test(verb) && Object.keys(schema.properties ?? {}).some((k) => CREATE_TEXT.has(k))) return "create";
  if ((module && TEACH_MODULES.has(module)) || name.startsWith("curriculum.material.")) return "teach";
  return "do";
}

// ── rule 6 ────────────────────────────────────────────────────────────────
// Seeded from DRAFT_DENY (tests/unit/ai-feature-coverage.test.ts), pruned of the
// risk-only entries (publish, void, verify, renew, finalize, setup, starter) and
// of its false positives: `marks?\b` also hits attendance.mark and exam.remark.save,
// and `\.marks` hits exam.marks_entry.* (opening a window carries no mark value).
export const RULE6_PATTERNS: readonly (readonly [RegExp, Rule6Family])[] = [
  [/(^|\.)marks(\.|$)|result|\.recheck\.decide$|^assignment\.grade$/i, "marks"],
  [/payment|receipt|payroll|payslip|canteen\.(topup|purchase)|concession.*decide|award\.decide|^library\.loan\.return$/i, "money"],
  [/member|permission|role|invite|^admissions\.application\.decide$|^lifecycle\.(transfer|withdraw)$/i, "access"],
  [/health|behaviour|hostel\.allocate|safety|dut(y|ies)\.(roster|swap)/i, "welfare"],
];

/** The rule-6 family an action name suggests; a classified row must state it by hand. */
export function rule6Family(name: string): Rule6Family | undefined {
  return RULE6_PATTERNS.find(([re]) => re.test(name))?.[1];
}

/** Field kinds that are rule-6 values: on a classified row they must be human-only. */
export const RULE6_KINDS: ReadonlySet<FieldKind> = new Set<FieldKind>(["rupees", "rupee_text", "paise", "marks"]);

// ── entities ──────────────────────────────────────────────────────────────
const ENTITY_BY_NAME: Readonly<Record<string, EntityType>> = {
  studentId: "student", studentIds: "student",
  staffId: "staff", hostStaffId: "staff", assigneeStaffId: "staff", ownerStaffId: "staff", substituteId: "staff",
  toStaffId: "staff", patronStaffId: "staff", classTeacherId: "staff", teacherId: "staff", reviewerId: "staff",
  guardianId: "guardian",
  classSectionId: "classSection", classSectionIds: "classSection", sectionId: "classSection", sectionIds: "classSection",
  fromSectionId: "classSection", toSectionId: "classSection", replaceSectionIds: "classSection",
  gradeId: "grade", subjectId: "subject", departmentId: "department",
  curriculumUnitId: "curriculumUnit", unitId: "curriculumUnit", unitIds: "curriculumUnit", focusUnitIds: "curriculumUnit",
  academicYearId: "academicYear", fromYearId: "academicYear", toYearId: "academicYear", termId: "term",
  examId: "exam", examPaperId: "exam.paper", resultId: "exam.result",
  invoiceId: "finance.invoice", invoiceIds: "finance.invoice", feeStructureId: "finance.feeStructure", paymentId: "finance.payment",
  awardId: "scholarships.award", bookId: "library.book", copyId: "library.copy",
  routeId: "transport.route", stopId: "transport.stop", vehicleId: "transport.vehicle", allocationId: "hostel.allocation",
  clubId: "clubs.club", houseId: "clubs.house", enquiryId: "admissions.enquiry", applicationId: "admissions.application",
  labId: "schoolLabs.lab", surveyId: "ptm.survey", leaveRequestId: "staffLeave", ticketId: "helpdesk.ticket",
  assetId: "facilities.asset", alertId: "safety.alert", formId: "forms.form", entryId: "diary.entry",
  submissionId: "assignment.submission", lessonPlanId: "lessonPlan", studyMaterialId: "study.material", textbookId: "textbook",
  announcementId: "announcement", threadId: "messaging.thread", counterpartId: "messaging.counterpart",
  insightId: "insight", supersedesId: "insight", incidentId: "behaviour.incident", achievementId: "achievement",
  pageId: "website.page", periodId: "timetable.period", substitutionId: "timetable.substitution",
  sessionId: "attendance.session", documentId: "document", pickupPersonId: "visitors.pickupPerson", questionId: "question",
};

// Field names that mean different records in different modules (design C1), keyed `${module}.${field}`.
const ENTITY_BY_MODULE: Readonly<Record<string, EntityType>> = {
  "timetable.roomId": "timetable.room", "hostel.roomId": "hostel.room", "exam_seating.roomId": "examSeating.room", "facilities.roomId": "facilities.room",
  "ptm.eventId": "ptm.event", "clubs.eventId": "clubs.event",
  "exams.requestId": "exam.recheck", "duties.requestId": "duty.swap", "facilities.requestId": "facilities.maintenanceRequest", "core.requestId": "studio.request",
  "ptm.slotId": "ptm.slot", "substitution.slotId": "timetable.slot", "timetable.slotId": "timetable.slot",
  "staff_attendance.leaveId": "staffLeave", "student_leave.leaveId": "studentLeave",
  "canteen.itemId": "canteen.item", "inventory.itemId": "inventory.item", "compliance.itemId": "compliance.item",
  "assignments.assignmentId": "assignment", "duties.assignmentId": "duty.assignment",
  "ptm.bookingId": "ptm.booking", "school_labs.bookingId": "schoolLabs.booking",
  "timetable.versionId": "timetable.version", "website.versionId": "website.version",
  "expenses.categoryId": "expenses.category", "scholarships.ruleId": "scholarships.rule",
  "exams.paperId": "exam.paper", "resources.resourceId": "resource",
  "ai_student.materialId": "study.material", "ai_teacher.materialId": "study.material", "assignments.materialId": "study.material",
  "attendance.recordId": "attendance.record",
};

/** The picker for a uuid field, by module first (collisions), then by name. Undefined: the row must say. */
export function deriveEntity(module: ModuleKey | undefined, name: string): EntityType | undefined {
  return (Object.hasOwn(ENTITY_BY_MODULE, `${module}.${name}`) ? ENTITY_BY_MODULE[`${module}.${name}`] : undefined)
    ?? (Object.hasOwn(ENTITY_BY_NAME, name) ? ENTITY_BY_NAME[name] : undefined);
}

// ── field kinds ───────────────────────────────────────────────────────────
const RUPEE_NUMBER = /^(amount|\w+Amount|fine_per_day|price|cost)$/;
const RUPEE_TEXT = /^(amount|cost)$/;
const ISO_DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

const isUuid = (node: JsonSchemaNode | undefined): boolean => node !== undefined && unwrap(node).format === "uuid";

/** Field kind from name, module and JSON Schema type (design C2: `money` is reused for exam marks). */
export function deriveFieldKind(module: ModuleKey | undefined, field: Pick<SchemaField, "name" | "node">): FieldKind {
  const { name, node } = field;
  const { type } = node;
  const items = node.items ? unwrap(node.items) : undefined;
  const numeric = type === "number" || type === "integer";
  if (name === "idempotencyKey") return "generated";
  if (isUuid(node) || (type === "array" && isUuid(items))) return "entity";
  if (name === "accessionNo") return "natural_key";
  if (type === "integer" && name.endsWith("Paise")) return "paise";
  if (numeric && ((module === "exams" && /marks/i.test(name)) || (module === "assignments" && /^(score|maxScore)$/.test(name)))) return "marks";
  if (numeric && RUPEE_NUMBER.test(name)) return "rupees";
  if (type === "string" && RUPEE_TEXT.test(name)) return "rupee_text";
  if (node.enum || (type === "array" && items?.enum)) return "enum";
  if (type === "string") {
    if (node.format === "date" || node.pattern === ISO_DATE_PATTERN) return "date";
    if (node.format === "date-time") return "datetime";
    if (node.pattern?.endsWith(":[0-5]\\d$")) return "time";
    return (node.maxLength ?? 0) > 200 ? "long_text" : "text";
  }
  // z.coerce.date() emits `{}`; the *At name rule recovers it (design §1).
  if (type === undefined && name.endsWith("At") && !node.properties && branches(node).length === 0) return "datetime";
  if (type === "boolean") return "boolean";
  if (numeric) return "number";
  if (type === "array") return "array";
  if (type === "object") return "object";
  return "unknown";
}

// ── merge ─────────────────────────────────────────────────────────────────
/** A hand-written row merged over the derived defaults. Family and human-only paths are never derived: rule 6 is written by hand. */
export function classify(name: string, meta: Pick<ActionMeta, "schema" | "module">, row: ClassifiedRow): ClassifiedTask {
  const schema = actionJsonSchema(meta);
  const fields = schemaFields(schema);
  const derived: Record<string, EntityRef> = {};
  const generated = new Set(row.generated ?? []);
  for (const f of fields) {
    const kind = deriveFieldKind(meta.module, f);
    if (kind === "generated") generated.add(f.path);
    const entity = kind === "entity" ? deriveEntity(meta.module, f.name) : undefined;
    if (entity) derived[f.path] = entity;
  }
  const seeded = ACTION_RISK[name];
  return {
    action: name,
    module: meta.module,
    label: row.label,
    description: row.description,
    mode: row.mode ?? deriveMode(name, meta.module, schema),
    groupId: row.groupId ?? groupFor(meta.module),
    risk: row.risk ?? (isTaskRisk(seeded) ? seeded : deriveRisk(name, schema)),
    family: row.family,
    humanOnly: row.humanOnly ?? [],
    generated: [...generated],
    entities: { ...derived, ...row.entities },
    undo: row.undo,
    visibleWith: row.visibleWith,
    renderer: row.renderer,
    defaultOn: row.defaultOn,
    requireOneOf: row.requireOneOf,
    href: row.href,
    done: row.done,
  };
}
