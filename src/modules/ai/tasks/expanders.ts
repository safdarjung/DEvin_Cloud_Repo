import "server-only";
// Orb task bridge — roster expanders (design C3). The model cannot list a
// roster (and on cloud must not read one), so a register task takes an intent
// ("8B present today except Ravi absent") and the server builds the full
// `records[]` from the section's real roster, read under the caller's RLS.
import type { TenantContext } from "@/lib/auth/types";
import { uuid } from "@/lib/schemas/common";
import { getSession, todayInInstitutionTimezone } from "@/modules/attendance/queries";
import { InstitutionSettingsSchema } from "@/modules/core/schemas";
import { normalizeLabel } from "./entities";
import { resolveOne, type Values } from "./resolve-refs";
import type { EntityOption, TaskFieldView } from "./types";

export interface Expansion {
  values: Values;
  /** Pointers the expander read under RLS: kept as given by entity resolution. */
  known: Record<string, EntityOption>;
}

interface Expander {
  /** Signature fields the model sees instead of the schema's (the intent form). */
  signature: string;
  expand: (ctx: TenantContext, values: Values) => Promise<Expansion>;
  /** Field view overrides from the school's settings (pattern path → patch). */
  fields?: (ctx: TenantContext) => Record<string, Partial<TaskFieldView>>;
}

const DAY_MS = 86_400_000;

const RELATIVE_DAYS: Readonly<Record<string, number>> = { yesterday: -1, today: 0, tomorrow: 1 };

/** "today" / "tomorrow" / "yesterday" → YYYY-MM-DD in the school's timezone; anything else unchanged. */
export function relativeDate(ctx: TenantContext, raw: unknown): unknown {
  const offset = typeof raw === "string" ? RELATIVE_DAYS[raw.trim().toLowerCase()] : undefined;
  if (offset === undefined) return raw;
  return new Date(Date.parse(`${todayInInstitutionTimezone(ctx)}T00:00:00Z`) + offset * DAY_MS).toISOString().slice(0, 10);
}

/** A register date: YYYY-MM-DD or a relative day; anything else is today. */
function intentDate(ctx: TenantContext, raw: unknown): string {
  const date = relativeDate(ctx, raw);
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayInInstitutionTimezone(ctx);
}

/** A configured status code from "present", "Absent", "L", … ; undefined when nothing matches. */
function statusCode(ctx: TenantContext, raw: unknown): string | undefined {
  const parsed = InstitutionSettingsSchema.shape.attendance.safeParse(ctx.institution.settings.attendance);
  if (!parsed.success || typeof raw !== "string" || !raw.trim()) return undefined;
  const want = normalizeLabel(raw);
  const statuses = parsed.data.statuses;
  return (
    statuses.find((s) => normalizeLabel(s.code) === want) ??
    statuses.find((s) => normalizeLabel(s.label) === want) ??
    statuses.find((s) => normalizeLabel(s.label).startsWith(want))
  )?.code;
}

/** The school's attendance statuses as an enum, so the card can show a segmented control per row. */
function statusField(ctx: TenantContext): Record<string, Partial<TaskFieldView>> {
  const parsed = InstitutionSettingsSchema.shape.attendance.safeParse(ctx.institution.settings.attendance);
  if (!parsed.success) return {};
  const statuses = parsed.data.statuses;
  return { "/records/*/status": { kind: "enum", options: statuses.map((s) => s.code), optionLabels: statuses.map((s) => s.label) } };
}

function defaultPresent(ctx: TenantContext): string | undefined {
  const parsed = InstitutionSettingsSchema.shape.attendance.safeParse(ctx.institution.settings.attendance);
  if (!parsed.success) return undefined;
  return statusCode(ctx, "present") ?? parsed.data.statuses.find((s) => s.counts_present === 1)?.code;
}

/** Roster intent → MarkAttendanceSchema / MarkPeriodAttendanceSchema input. Unmatched names keep the default status. */
async function expandRegister(ctx: TenantContext, values: Values): Promise<Expansion> {
  const { default: fallback, except, records, ...rest } = values;
  // Rows the person already has are kept; an empty or missing list is (re)built from the section's roster.
  if (Array.isArray(records) && records.length > 0) return { values: { ...rest, records }, known: {} };
  const raw = rest.classSectionId;
  const section = typeof raw === "string" ? await resolveOne(ctx, "classSection", raw) : null;
  const date = intentDate(ctx, rest.date);
  if (!section || !("option" in section)) return { values: { ...rest, date }, known: {} };

  const register = await getSession(ctx, section.option.id, date);
  const base = statusCode(ctx, fallback) ?? defaultPresent(ctx);
  if (!register || !base) return { values: { ...rest, classSectionId: section.option.id, date }, known: { "/classSectionId": section.option } };

  const overrides = new Map<string, { status: string; note?: string }>();
  for (const item of Array.isArray(except) ? except : []) {
    if (typeof item !== "object" || item === null) continue;
    const { student, status, note } = item as Record<string, unknown>;
    const code = statusCode(ctx, status);
    if (typeof student !== "string" || !code) continue;
    const words = student.split(/\s+/).map(normalizeLabel).filter(Boolean);
    const hits = register.students.filter((s) =>
      uuid.safeParse(student).success ? s.studentId === student : words.length > 0 && words.every((w) => normalizeLabel(s.name).includes(w)),
    );
    // Ambiguous or unknown names are left at the default; the person sees every row before approving.
    if (hits.length === 1) overrides.set(hits[0]!.studentId, { status: code, ...(typeof note === "string" && note.trim() ? { note: note.trim().slice(0, 200) } : {}) });
  }

  const known: Record<string, EntityOption> = { "/classSectionId": section.option };
  const rows = register.students.map((s, i) => {
    known[`/records/${i}/studentId`] = { id: s.studentId, label: s.name, ...(s.rollNo !== null ? { hint: `Roll ${s.rollNo}` } : {}) };
    return { studentId: s.studentId, status: base, ...overrides.get(s.studentId) };
  });
  return { values: { ...rest, classSectionId: section.option.id, date, records: rows }, known };
}

const REGISTER_FIELDS = "classSectionId:ref! date:date default:status except:list(student,status)";

export const EXPANDERS: Readonly<Record<string, Expander>> = {
  "attendance.mark": { signature: REGISTER_FIELDS, expand: expandRegister, fields: statusField },
  "attendance.markPeriod": { signature: `${REGISTER_FIELDS} periodId:ref!`, expand: expandRegister, fields: statusField },
};
