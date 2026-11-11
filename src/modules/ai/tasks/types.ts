// Orb task bridge — the shared contract (docs/planning/orb-task-bridge/DESIGN.md).
// Importable from server and client code: type-only imports, no runtime code.
// The client renders a card from TaskView alone and never imports Zod schemas.
import type { Permission, Role } from "@/lib/auth/permissions";
import type { ModuleKey } from "@/lib/modules/catalog";
import type { RiskClass } from "@/modules/agents/catalog";
import type { OrbGroupId } from "@/modules/ai/components/orb/orb-groups";

/** Orb tabs. "teach" is its own mode (staff teaching work); "learn" is the student's own study. A mode with no features is hidden. */
export type OrbMode = "ask" | "do" | "create" | "teach" | "learn" | "manage";

/** The mode a task sits in: every orb mode except free-form Ask. */
export type TaskMode = Exclude<OrbMode, "ask">;

/** Card risk, reusing the agents' RiskClass: low = batchable, user_confirmed = card by card, human_approved = card by card with a checked box. */
export type TaskRisk = Extract<RiskClass, "low_risk_reversible" | "user_confirmed" | "human_approved">;

/** CLAUDE.md rule 6: values the AI never supplies. */
export type Rule6Family = "marks" | "money" | "access" | "welfare";

/** How the card renders one input field; money and marks come from field name plus module (design C2), never from the Zod type. */
export type FieldKind =
  | "enum" // select, or radio when there are 5 options or fewer
  | "entity" // picker over an EntityType
  | "generated" // hidden, filled once by the card or server (idempotencyKey)
  | "context" // hidden, filled from the page, the signed-in person or an earlier card's result
  | "natural_key" // typed key with lookup (library accessionNo)
  | "date" // YYYY-MM-DD
  | "datetime" // ISO date-time, shown in the school's timezone
  | "time" // HH:MM
  | "rupees" // rupee decimal number (finance, fee plans)
  | "rupee_text" // rupee amount sent as text (expenses, lab incident cost)
  | "paise" // integer paise, typed in rupees and sent ×100 (canteen, payroll, scholarships)
  | "marks" // exam marks or a graded score (rule 6)
  | "text" // single line, 200 characters or fewer
  | "long_text" // textarea
  | "boolean"
  | "number"
  | "array" // repeater over child fields
  | "object" // fieldset over child fields
  | "unknown"; // no usable schema; the row must name a renderer

/** What an entity picker searches, keyed by owning module where field names collide (roomId, eventId, requestId, slotId, leaveId…). */
export type EntityType =
  | "student" | "staff" | "guardian" | "classSection" | "grade" | "subject" | "curriculumUnit" | "academicYear" | "term" | "department"
  | "exam" | "exam.paper" | "exam.result" | "exam.recheck" | "examSeating.room"
  | "finance.invoice" | "finance.feeStructure" | "finance.payment" | "expenses.category" | "scholarships.award" | "scholarships.rule"
  | "library.book" | "library.copy"
  | "transport.route" | "transport.stop" | "transport.vehicle"
  | "hostel.room" | "hostel.allocation"
  | "clubs.club" | "clubs.event" | "clubs.house"
  | "admissions.enquiry" | "admissions.application"
  | "inventory.item" | "canteen.item" | "compliance.item" | "schoolLabs.lab" | "schoolLabs.booking"
  | "calendar.event" | "ptm.event" | "ptm.slot" | "ptm.booking" | "ptm.survey" | "staffLeave" | "studentLeave"
  | "helpdesk.ticket" | "facilities.maintenanceRequest" | "facilities.asset" | "facilities.room"
  | "duty.assignment" | "duty.swap" | "safety.alert" | "visitors.visit" | "visitors.pickupPerson"
  | "forms.form" | "diary.entry" | "assignment" | "assignment.submission" | "lessonPlan" | "question" | "resource" | "study.material" | "textbook"
  | "announcement" | "messaging.thread" | "messaging.counterpart" | "insight" | "behaviour.incident" | "achievement"
  | "website.page" | "website.notice" | "website.version"
  | "timetable.room" | "timetable.period" | "timetable.version" | "timetable.slot" | "timetable.substitution"
  | "attendance.session" | "attendance.record" | "studio.request" | "document";

/** A field's entity: a picker type, or "context" when the server fills it without a picker. */
export type EntityRef = EntityType | "context";

/** Hosted forms for roster and rule-6 tasks (design §4); the card mounts the existing component instead of generated fields. */
export type TaskRendererKey = "attendance.register" | "exams.marksGrid" | "finance.recordPayment" | "exams.recheckDecision";

/** Hand-written catalog row: a label plus overrides of the derived defaults. Paths are JSON pointers with "*" for an array item. */
export interface ClassifiedRow {
  /** Human label, also the card title stem ("Issue a library book"). */
  label: string;
  /** Optional one-line help under the label. */
  description?: string;
  /** Overrides the derived mode. */
  mode?: TaskMode;
  /** Overrides the module's orb group. */
  groupId?: OrbGroupId;
  /** Overrides ACTION_RISK and the verb rule. */
  risk?: TaskRisk;
  /** Rule-6 family; required when the name matches a rule-6 pattern or a field is money or marks. */
  family?: Rule6Family;
  /** Fields the person must type; stripped from model input at proposal creation. */
  humanOnly?: readonly string[];
  /** Fields the card or server fills (beyond the derived idempotencyKey); never from the model. */
  generated?: readonly string[];
  /** Entity per field path, overriding the derived one. */
  entities?: Readonly<Record<string, EntityRef>>;
  /** Registered action that reverses this one; offered as a new one-click proposal. */
  undo?: string;
  /** Static permission that shows the task when the action's own permission depends on input (design C5). */
  visibleWith?: Permission;
  /** Hosted form instead of generated fields. */
  renderer?: TaskRendererKey;
  /** Roles the task is on for by default; absent means the mode default (design §9.4). */
  defaultOn?: readonly Role[];
  /** Groups of paths where at least one must have a value (the action refuses otherwise), e.g. [["/studentId", "/staffId"]]. */
  requireOneOf?: readonly (readonly string[])[];
  /** Page where the record lives, relative to the school ("/library"); default: the module's page in nav.ts. */
  href?: string;
  /** Result line after approval; {field} is a resolved name, the action's result or the approved value ("Issued {accessionNo} to {studentId}, due {dueOn}"). */
  done?: string;
  excluded?: never;
}

/** A registered action kept out of the orb, with the reason. */
export interface ExcludedRow {
  excluded: string;
  label?: never;
}

/** One catalog entry, keyed by registered action name. */
export type TaskRow = ClassifiedRow | ExcludedRow;

/** A classified row merged with its derived defaults: what the server, signature and control centre use. */
export interface ClassifiedTask {
  action: string;
  module?: ModuleKey;
  label: string;
  description?: string;
  mode: TaskMode;
  groupId: OrbGroupId;
  risk: TaskRisk;
  family?: Rule6Family;
  humanOnly: readonly string[];
  generated: readonly string[];
  /** Every uuid field with a known entity (derived, then the row's overrides). */
  entities: Readonly<Record<string, EntityRef>>;
  undo?: string;
  visibleWith?: Permission;
  renderer?: TaskRendererKey;
  defaultOn?: readonly Role[];
  requireOneOf?: readonly (readonly string[])[];
  href?: string;
  done?: string;
}

/** One choice in an entity picker, or the resolved display of a prefilled id. */
export interface EntityOption {
  id: string;
  label: string;
  hint?: string;
}

/** One input the card renders, built on the server from the action's JSON schema and the catalog row. */
export interface TaskFieldView {
  /** JSON pointer with "*" for array items. */
  path: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  /** Kind "entity": what the picker searches. */
  entity?: EntityType;
  /** An array of scalar values (several entities or enum values). */
  multiple?: boolean;
  /** Kind "enum": allowed values. */
  options?: readonly string[];
  /** Kind "enum": a display label per option, same order (attendance status codes "P" → "Present"). */
  optionLabels?: readonly string[];
  /** Text kinds: character limit. */
  maxLength?: number;
  min?: number;
  max?: number;
  /** Kind "array": row limit. */
  maxItems?: number;
  /** Rule 6: the person types it; never prefilled. */
  humanOnly?: boolean;
  /** Kinds "array" and "object": child fields (absolute paths). */
  fields?: readonly TaskFieldView[];
}

/** Everything the approval card shows; the browser reads only this (the tool output), never the raw tool-call input. */
export interface TaskView {
  action: string;
  label: string;
  /** Built by code from the label and resolved names, never from model text. */
  title: string;
  mode: TaskMode;
  groupId: OrbGroupId;
  risk: TaskRisk;
  family?: Rule6Family;
  renderer?: TaskRendererKey;
  fields: readonly TaskFieldView[];
  /** Groups of paths where at least one must be filled before Approve is enabled. */
  requireOneOf?: readonly (readonly string[])[];
  /** The sanitized partial input: no human-only or generated keys. */
  values: Readonly<Record<string, unknown>>;
  /** Concrete path ("/records/3/studentId") → display of the prefilled id. */
  resolved: Readonly<Record<string, EntityOption>>;
  /** Concrete path → choices when a model value matched several records. */
  candidates: Readonly<Record<string, readonly EntityOption[]>>;
  /** Proposal this card waits for (multi-step); approve stays disabled until it is approved. */
  dependsOn?: string;
  /** "Suggested after reading <source>" when the proposal followed free-text records. */
  provenance?: string;
  /** Undo action offered after approval. */
  undo?: string;
  /** ISO time the proposal expires. */
  expiresAt: string;
}

/** The propose_task tool output the card reads. */
export interface TaskProposalOutput {
  kind: "task_proposal";
  proposalId: string;
  view: TaskView;
}

/** ai_proposals.status (migration 0143). */
export type ProposalStatus = "pending" | "approving" | "approved" | "discarded" | "expired" | "failed";

/** Audit event names the bridge writes, besides each target action's own event (no payloads). */
export type TaskAuditEvent = "ai.proposal.created" | "ai.proposal.approved" | "ai.proposal.discarded" | "ai.proposal.opened";
