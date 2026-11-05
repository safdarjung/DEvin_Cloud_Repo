import "server-only";
// X02-T8 — certificates.list + certificates.printHtml. RLS
// (certificates_select, 0091) is the only narrowing; the explicit
// institution_id filter below is defense in depth (mirrors every other
// queries.ts, e.g. src/modules/lifecycle/queries.ts). Display fields come
// from the row-sourced snapshot (rule 5: immutable history), not a live
// join, so a later rename never changes an already-issued certificate.
import { createClient } from "@/lib/supabase/server";
import { AppError } from "@/lib/actions/result";
import type { TenantContext } from "@/lib/auth/types";
import { renderCertificateHtml } from "./certificate-html.ts";
import { CertificateSnapshotSchema, type CertificateKind } from "./schemas.ts";

export interface CertificateRow {
  id: string;
  kind: CertificateKind;
  serialNo: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  classLabel: string;
  issuedOn: string;
  issuedAt: string;
  issuedByName: string;
  purpose: string | null;
  conduct: string | null;
}

export interface CertificateListFilters {
  studentId?: string;
  serialNo?: string;
  kind?: CertificateKind;
  limit: number;
}

function toCertificateRow(row: {
  id: string;
  kind: string;
  serial_no: string;
  student_id: string;
  issued_at: string;
  snapshot: unknown;
}): CertificateRow {
  const snap = row.snapshot as Record<string, unknown>;
  const student = (snap.student ?? {}) as Record<string, unknown>;
  const enrolment = snap.enrolment as Record<string, unknown> | null;
  return {
    id: row.id,
    kind: row.kind as CertificateKind,
    serialNo: row.serial_no,
    studentId: row.student_id,
    studentName: student.name == null ? "" : String(student.name),
    admissionNo: student.admission_no == null ? "" : String(student.admission_no),
    classLabel: enrolment ? `${String(enrolment.grade)}-${String(enrolment.section)}` : "",
    issuedOn: snap.issued_on == null ? "" : String(snap.issued_on),
    issuedAt: row.issued_at,
    issuedByName: snap.issued_by_name == null ? "" : String(snap.issued_by_name),
    purpose: snap.purpose == null ? null : String(snap.purpose),
    conduct: snap.conduct == null ? null : String(snap.conduct),
  };
}

/** Newest first; studentId/serialNo/kind narrow further, RLS is the real filter. */
export async function listCertificates(ctx: TenantContext, filters: CertificateListFilters): Promise<CertificateRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("certificates")
    .select("id, kind, serial_no, student_id, issued_at, snapshot")
    .eq("institution_id", ctx.institution.id);
  if (filters.studentId) query = query.eq("student_id", filters.studentId);
  if (filters.serialNo) query = query.eq("serial_no", filters.serialNo);
  if (filters.kind) query = query.eq("kind", filters.kind);
  const { data, error } = await query.order("issued_at", { ascending: false }).limit(filters.limit);
  if (error) throw error;
  return (data ?? []).map(toCertificateRow);
}

/** Renders the frozen snapshot as the printable document; a reprint is byte-identical. */
export async function certificateHtml(ctx: TenantContext, certificateId: string): Promise<{ html: string } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("certificates")
    .select("snapshot")
    .eq("id", certificateId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const parsed = CertificateSnapshotSchema.safeParse(data.snapshot);
  if (!parsed.success) throw new AppError("internal", "Certificate snapshot failed validation.");

  return { html: renderCertificateHtml(parsed.data) };
}
