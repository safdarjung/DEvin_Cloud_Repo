import "server-only";
// Orb task bridge — entity pickers (design §1 "Pickers and the registered query
// behind each"). Every read goes through the owning module's queries.ts under
// the caller's own RLS client, and only when the caller passes that module's
// registered query gate (its permission and module), so a picker never shows
// more than the person could already read. An entity type with no backing
// query returns no options; a model-supplied id for it is dropped.
import "@/app/api/v1/query/all-queries"; // query meta (permission + module) for the gates below
import { getQueryMeta } from "@/lib/actions/define-query";
import { hasPermission } from "@/lib/auth/require";
import type { TenantContext } from "@/lib/auth/types";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { listSectionSubjects, listCurriculumUnits, listTeachableSections, listTeacherAssignments } from "@/modules/academics/assignments.queries";
import { listAchievements } from "@/modules/achievements/queries";
import { listEnquiriesByStage } from "@/modules/admissions/queries";
import { getTodaySectionsForTeacher } from "@/modules/attendance/queries";
import { canteenItems } from "@/modules/canteen/queries";
import { clubEventsList, clubsList, housesLeaderboard } from "@/modules/clubs/queries";
import { complianceItems } from "@/modules/compliance/queries";
import { diaryForStudent } from "@/modules/diary/queries";
import { dutyTypes } from "@/modules/duties/queries";
import { listExams, listRecheckQueue, listSectionOptions, listSubjectOptions, listTermOptions as examTermOptions } from "@/modules/exams/queries";
import { expenseCategories } from "@/modules/expenses/queries";
import { facilitiesAssets, facilitiesMaintenanceRequests } from "@/modules/facilities/queries";
import { listAcademicYears, listFeeStructures, listGradeOptions, listTermOptions as financeTermOptions } from "@/modules/finance/queries";
import { formList } from "@/modules/forms/queries";
import { listTickets } from "@/modules/helpdesk/queries";
import { hostelRooms } from "@/modules/hostel/queries";
import { listInsights } from "@/modules/insights/queries";
import { ListInsightsSchema } from "@/modules/insights/schemas";
import { inventoryStock } from "@/modules/inventory/queries";
import { libraryCatalog } from "@/modules/library/queries";
import { leaveRequests } from "@/modules/people/hr.queries";
import { getStudentProfile, listMyChildren, listStudents, searchStaff } from "@/modules/people/queries";
import { ptmEvents } from "@/modules/ptm/queries";
import { surveyList } from "@/modules/ptm/survey.queries";
import { listQuestions } from "@/modules/question-bank/queries";
import { QuestionListSchema } from "@/modules/question-bank/schemas";
import { concessionRules } from "@/modules/scholarships/queries";
import { schoolLabs } from "@/modules/school-labs/queries";
import { studentLeaveRequests } from "@/modules/student-leave/queries";
import { transportRoutes, transportVehicles } from "@/modules/transport/queries";
import { visitorsGatePasses } from "@/modules/visitors/queries";
import type { EntityOption, EntityType } from "./types";

export const MAX_OPTIONS = 20;

/** Sibling values that narrow a picker (section → subject → unit). */
export type EntityScope = Readonly<Record<string, string>>;

interface EntitySource {
  /** Registered query whose permission and module this source follows. */
  query: string;
  /** Null when this source cannot serve the scope (the next source is tried). */
  list: (ctx: TenantContext, search: string | undefined, scope: EntityScope) => Promise<EntityOption[] | null>;
  /** Exact lookup for paged or searched lists. */
  byId?: (ctx: TenantContext, id: string) => Promise<EntityOption | null>;
}

const name = (first: string, last: string | null): string => [first, last].filter(Boolean).join(" ");
const opt = (id: string, label: string, hint?: string | null): EntityOption => (hint ? { id, label, hint } : { id, label });

async function sectionGrade(ctx: TenantContext, classSectionId: string | undefined): Promise<string | undefined> {
  if (!classSectionId) return undefined;
  return (await listTeachableSections(ctx)).find((s) => s.id === classSectionId)?.gradeId;
}

/** A guardian's children or a student's own record (the card's pinned studentId narrows it); staff get none. */
async function ownStudentIds(ctx: TenantContext, scope: EntityScope): Promise<string[]> {
  if (scope.studentId) return [scope.studentId];
  if (ctx.membership.role === "student") return ctx.membership.studentId ? [ctx.membership.studentId] : [];
  return ctx.membership.role === "guardian" ? (await listMyChildren(ctx)).map((c) => c.id) : [];
}

const short = (text: string, max = 80): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const SOURCES: Partial<Record<EntityType, readonly EntitySource[]>> = {
  student: [
    {
      query: "people.searchStudents",
      list: async (ctx, search) =>
        (await listStudents(ctx, search, 1)).students.map((s) =>
          opt(s.id, name(s.firstName, s.lastName), [s.gradeName, s.sectionName].filter(Boolean).join(" ") || s.admissionNo),
        ),
      byId: async (ctx, id) => {
        const s = await getStudentProfile(ctx, id);
        return s ? opt(s.id, name(s.firstName, s.lastName), s.enrolment ? `${s.enrolment.gradeName} ${s.enrolment.sectionName}` : s.admissionNo) : null;
      },
    },
  ],
  staff: [
    {
      query: "people.searchStaff",
      list: async (ctx, search) => (await searchStaff(ctx, { query: search })).map((s) => opt(s.id, s.fullName, s.designation)),
      byId: async (ctx, id) => {
        const [s] = await searchStaff(ctx, { id });
        return s ? opt(s.id, s.fullName, s.designation) : null;
      },
    },
  ],
  classSection: [
    { query: "exams.listSectionOptions", list: async (ctx) => (await listSectionOptions(ctx)).map((s) => opt(s.id, s.label)) },
    {
      // Teachers: sections they teach; the class-teacher list carries the grade code ("8-B"), so "8B" matches.
      query: "academics.listTeachableSections",
      list: async (ctx) => {
        const [teachable, register] = await Promise.all([listTeachableSections(ctx), getTodaySectionsForTeacher(ctx)]);
        const labels = new Map(register.map((s) => [s.id, s.label]));
        return teachable.map((s) => opt(s.id, labels.get(s.id) ?? s.label));
      },
    },
  ],
  subject: [
    {
      query: "academics.listSectionSubjects",
      list: async (ctx, _s, scope) => (scope.classSectionId ? (await listSectionSubjects(ctx, scope.classSectionId)).map((s) => opt(s.id, s.name)) : null),
    },
    { query: "exams.listSubjectOptions", list: async (ctx) => (await listSubjectOptions(ctx)).map((s) => opt(s.id, s.name)) },
  ],
  grade: [{ query: "finance.listGradeOptions", list: async (ctx) => (await listGradeOptions(ctx)).map((g) => opt(g.id, g.label)) }],
  curriculumUnit: [
    {
      query: "academics.listCurriculumUnits",
      list: async (ctx, _s, scope) => {
        const gradeId = scope.gradeId ?? (await sectionGrade(ctx, scope.classSectionId));
        if (!gradeId || !scope.subjectId) return null;
        return (await listCurriculumUnits(ctx, { gradeId, subjectId: scope.subjectId })).map((u) => opt(u.id, u.title, `Unit ${u.sequence}`));
      },
    },
  ],
  term: [
    { query: "exams.listTermOptions", list: async (ctx) => (await examTermOptions(ctx)).map((t) => opt(t.id, t.label)) },
    { query: "finance.listTermOptions", list: async (ctx) => (await financeTermOptions(ctx)).map((t) => opt(t.id, t.label)) },
  ],
  academicYear: [{ query: "finance.listAcademicYears", list: async (ctx) => (await listAcademicYears(ctx)).map((y) => opt(y.id, y.label)) }],
  staffLeave: [
    {
      query: "people.leaveRequests",
      list: async (ctx) =>
        (await leaveRequests(ctx, { status: "pending", limit: 50 })).map((l) =>
          opt(l.id, `${l.staffName}: ${l.leaveType} leave`, `${l.startDate} to ${l.endDate}`),
        ),
    },
  ],
  studentLeave: [
    {
      query: "studentLeave.list",
      list: async (ctx) =>
        (await studentLeaveRequests(ctx, { status: "pending", limit: 50 })).map((l) =>
          opt(l.id, `${l.studentName}: leave`, `${l.classSection}, ${l.startDate} to ${l.endDate}`),
        ),
    },
  ],
  "clubs.club": [{ query: "clubs.list", list: async (ctx) => (await clubsList(ctx)).map((c) => opt(c.id, c.name, c.patronName)) }],
  "helpdesk.ticket": [
    { query: "helpdesk.tickets", list: async (ctx) => (await listTickets(ctx, {})).rows.map((t) => opt(t.id, t.subject, `${t.raisedByName}, ${t.status}`)) },
    // Teachers, students and guardians: their own tickets (same reader, RLS narrows it).
    { query: "helpdesk.myTickets", list: async (ctx) => (await listTickets(ctx, {})).rows.map((t) => opt(t.id, t.subject, t.status)) },
  ],
  "admissions.enquiry": [
    {
      query: "admissions.listEnquiriesByStage",
      list: async (ctx) =>
        Object.values(await listEnquiriesByStage(ctx))
          .flat()
          .map((e) => opt(e.id, e.childName, `${e.guardianName}, ${e.status}`)),
    },
  ],
  insight: [{ query: "insights.list", list: async (ctx) => (await listInsights(ctx, ListInsightsSchema.parse({}))).map((i) => opt(i.id, i.title)) }],
  "expenses.category": [
    { query: "expenses.categories", list: async (ctx) => (await expenseCategories(ctx)).filter((c) => c.isActive).map((c) => opt(c.id, c.name)) },
  ],
  "schoolLabs.lab": [{ query: "schoolLabs.labs", list: async (ctx) => (await schoolLabs(ctx)).map((l) => opt(l.id, l.name, l.kind)) }],
  "ptm.event": [{ query: "ptm.events", list: async (ctx) => (await ptmEvents(ctx, false)).map((e) => opt(e.id, e.title, e.eventDate)) }],
  "forms.form": [{ query: "form.list", list: async (ctx) => (await formList(ctx)).map((f) => opt(f.id, f.title, f.status)) }],
  assignment: [
    { query: "academics.listTeacherAssignments", list: async (ctx) => (await listTeacherAssignments(ctx)).map((a) => opt(a.id, a.title, a.status)) },
  ],
  exam: [{ query: "exams.listExams", list: async (ctx) => (await listExams(ctx)).map((e) => opt(e.id, e.name, `${e.termName}, ${e.status}`)) }],
  "exam.recheck": [
    { query: "exams.listRecheckQueue", list: async (ctx) => (await listRecheckQueue(ctx)).map((r) => opt(r.id, `${r.studentName}: recheck`, r.status)) },
  ],
  "facilities.asset": [
    { query: "facilities.assets", list: async (ctx) => (await facilitiesAssets(ctx)).map((a) => opt(a.id, a.name, a.room ?? a.location ?? a.category)) },
  ],
  "facilities.maintenanceRequest": [
    {
      query: "facilities.maintenanceRequests",
      list: async (ctx) =>
        (await facilitiesMaintenanceRequests(ctx)).filter((r) => r.status !== "done").map((r) => opt(r.id, short(r.issue), `${r.asset}, ${r.status}`)),
    },
  ],
  "inventory.item": [
    { query: "inventory.stock", list: async (ctx) => (await inventoryStock(ctx)).map((i) => opt(i.itemId, i.name, `${i.onHand} ${i.unit} in stock`)) },
  ],
  // shortcut: the catalogue's first 100 books; search narrows those only. Upgrade by passing `q` when schools pass 100 titles.
  "library.book": [{ query: "library.catalog", list: async (ctx) => (await libraryCatalog(ctx, { limit: 100 })).map((b) => opt(b.id, b.title, b.author)) }],
  "transport.route": [{ query: "transport.routes", list: async (ctx) => (await transportRoutes(ctx)).map((r) => opt(r.id, r.name, `${r.stops.length} stops`)) }],
  "transport.stop": [
    {
      query: "transport.routes",
      list: async (ctx) => (await transportRoutes(ctx)).flatMap((r) => r.stops.map((s) => opt(s.id, s.name, `${r.name}, ${s.eta}`))),
    },
  ],
  "transport.vehicle": [{ query: "transport.vehicles", list: async (ctx) => (await transportVehicles(ctx)).map((v) => opt(v.id, v.registrationNo, v.driverName)) }],
  "hostel.room": [{ query: "hostel.rooms", list: async (ctx) => (await hostelRooms(ctx)).map((r) => opt(r.id, `${r.block} ${r.roomNo}`, `${r.occupied} of ${r.capacity} beds`)) }],
  "clubs.event": [
    { query: "clubs.events", list: async (ctx) => (await clubEventsList(ctx)).map((e) => opt(e.id, e.title, `${e.clubName}, ${e.startsAt.slice(0, 10)}`)) },
  ],
  "clubs.house": [{ query: "clubs.houseLeaderboard", list: async (ctx) => (await housesLeaderboard(ctx)).map((h) => opt(h.id, h.name)) }],
  "compliance.item": [{ query: "compliance.items", list: async (ctx) => (await complianceItems(ctx)).map((c) => opt(c.id, c.title, `due ${c.dueOn}`)) }],
  "canteen.item": [
    { query: "canteen.items", list: async (ctx) => (await canteenItems(ctx, { includeInactive: true })).map((i) => opt(i.id, i.name, i.isActive ? null : "inactive")) },
  ],
  "duty.type": [{ query: "duties.types", list: async (ctx) => (await dutyTypes(ctx)).map((d) => opt(d.id, d.name, d.isActive ? null : "inactive")) }],
  question: [
    {
      query: "questionBank.list",
      list: async (ctx) =>
        (await listQuestions(ctx, QuestionListSchema.parse({ pageSize: 100 }))).items.map((q) => opt(q.id, short(q.body), `${q.gradeCode} ${q.subjectName}`)),
    },
  ],
  "ptm.survey": [{ query: "survey.list", list: async (ctx) => (await surveyList(ctx)).map((s) => opt(s.id, s.title, s.status)) }],
  "scholarships.rule": [
    { query: "scholarships.rules", list: async (ctx) => (await concessionRules(ctx, { includeInactive: true })).map((r) => opt(r.id, r.name, r.isActive ? null : "inactive")) },
  ],
  "finance.feeStructure": [{ query: "finance.listFeeStructures", list: async (ctx) => (await listFeeStructures(ctx)).map((f) => opt(f.id, f.name)) }],
  "visitors.gatePass": [
    {
      query: "visitors.gatePasses",
      list: async (ctx) => (await visitorsGatePasses(ctx, {})).map((g) => opt(g.id, `${g.studentName}: gate pass`, `${g.collectorName}, ${g.status}`)),
    },
  ],
  achievement: [
    {
      query: "achievements.list",
      list: async (ctx) =>
        (await listAchievements(ctx)).rows.filter((a) => !a.voidedAt).map((a) => opt(a.id, `${a.studentName}: ${a.title}`, a.verified ? "verified" : "not verified")),
    },
  ],
  // Families acknowledge entries of their own child's section; staff have no list here (null: no source serves them).
  "diary.entry": [
    {
      query: "diary.forStudent",
      list: async (ctx, _s, scope) => {
        const ids = await ownStudentIds(ctx, scope);
        if (!ids.length) return null;
        // Siblings in one section share entries: one option each.
        const rows = new Map((await Promise.all(ids.map((id) => diaryForStudent(ctx, id)))).flat().map((e) => [e.id, e]));
        return [...rows.values()].map((e) => opt(e.id, short(`${e.subject?.name ?? "Diary"}: ${e.body}`), `${e.entryDate}${e.acknowledged ? ", acknowledged" : ""}`));
      },
    },
  ],
};

/** Entity types with at least one source; the rest have no backing query (design C1 gaps). */
export const SEARCHABLE_ENTITIES: readonly EntityType[] = Object.keys(SOURCES) as EntityType[];

function allowed(ctx: TenantContext, source: EntitySource): boolean {
  const meta = getQueryMeta().get(source.query);
  if (!meta || typeof meta.permission !== "string") return false;
  return hasPermission(ctx, meta.permission) && (meta.module === undefined || isModuleEnabled(ctx, meta.module));
}

/** Lower-case letters and digits only, minus filler words, so "Class 8B" matches "8-B" and "Ms. Rao" matches "Rao". */
export function normalizeLabel(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b(class|grade|section|std|mr|mrs|ms|dr|sir|madam)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

const ROMAN = ["", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii"];

/** "10", "10th", "10a" also as Roman "x", "xa": sections are named "Grade X A" but said "class 10". */
export function numeralForms(word: string): string[] {
  const m = /^(\d{1,2})(?:st|nd|rd|th)?([a-z])?$/.exec(word);
  const roman = m ? ROMAN[Number(m[1])] : undefined;
  return roman ? [word, `${roman}${m![2] ?? ""}`] : [word];
}

function matches(option: EntityOption, search: string): boolean {
  const label = `${option.label} ${option.hint ?? ""}`;
  const target = normalizeLabel(label);
  // A Roman class number must be a whole word ("x" is in "xi"): checked against the label's own words.
  const tokens = label.toLowerCase().replace(/\b(class|grade|section|std)\b\.?/g, " ").split(/[^a-z0-9]+/).filter(Boolean);
  const romanHit = (form: string) => tokens.some((t, i) => t === form || `${t}${tokens[i + 1] ?? ""}` === form);
  const words = search.split(/\s+/).map(normalizeLabel).filter(Boolean);
  return words.length > 0 && words.every((w) => target.includes(w) || numeralForms(w).slice(1).some(romanHit));
}

async function firstServed(ctx: TenantContext, entity: EntityType, search: string | undefined, scope: EntityScope) {
  for (const source of SOURCES[entity] ?? []) {
    if (!allowed(ctx, source)) continue;
    const list = await source.list(ctx, search, scope);
    if (list) return { source, list };
  }
  return null;
}

/** At most 20 picker options, filtered by the search text, read under the caller's RLS. */
export async function searchEntities(ctx: TenantContext, entity: EntityType, search?: string, scope: EntityScope = {}): Promise<EntityOption[]> {
  const text = search?.trim() || undefined;
  const served = await firstServed(ctx, entity, text, scope);
  if (!served) return [];
  return (text ? served.list.filter((o) => matches(o, text)) : served.list).slice(0, MAX_OPTIONS);
}

/** One record by id, only if the caller can read it through a picker source; null otherwise. */
export async function findEntity(ctx: TenantContext, entity: EntityType, id: string, scope: EntityScope = {}): Promise<EntityOption | null> {
  for (const source of SOURCES[entity] ?? []) {
    if (!allowed(ctx, source)) continue;
    if (source.byId) return source.byId(ctx, id);
    const list = await source.list(ctx, undefined, scope);
    if (list) return list.find((o) => o.id === id) ?? null;
  }
  return null;
}
