import "server-only";
// X02-T9 — certificates.idCardsHtml. RLS on class_sections/enrolments/
// guardian_students/documents is the real visibility filter; the explicit
// institution_id filters below are defense in depth (mirrors ./queries.ts).
// Storage reads use the caller's own client (never service role), same
// rule as src/modules/documents/actions.ts.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { renderIdCardsHtml, type IdCard } from "./id-card-html.ts";

export const ID_CARD_MAX = 60;
export const ID_CARD_PHOTO_MAX_BYTES = 51200;

const BUCKET = "tenant-docs";

interface EnrolmentRow {
  student_id: string;
  roll_no: number | null;
  students: { first_name: string; last_name: string | null; admission_no: string; dob: string } | null;
}

/** roll_no asc, nulls last, then first_name — rulings "ID cards". DB-side query already orders by both columns before `.limit()` (deterministic truncation); this re-sort is a defense-in-depth no-op on the already-ordered page. */
function sortEnrolments(rows: EnrolmentRow[]): EnrolmentRow[] {
  return [...rows].sort((a, b) => {
    const rollA = a.roll_no ?? Number.POSITIVE_INFINITY;
    const rollB = b.roll_no ?? Number.POSITIVE_INFINITY;
    if (rollA !== rollB) return rollA - rollB;
    return (a.students?.first_name ?? "").localeCompare(b.students?.first_name ?? "");
  });
}

/** One card per active enrolment of the section; null when the section isn't visible (RLS or wrong institution). */
export async function idCardsHtml(ctx: TenantContext, classSectionId: string): Promise<{ html: string } | null> {
  const supabase = await createClient();

  const [sectionResult, institutionResult] = await Promise.all([
    supabase
      .from("class_sections")
      .select("name, grades(code), academic_years(name)")
      .eq("id", classSectionId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle(),
    supabase.from("institutions").select("board").eq("id", ctx.institution.id).single(),
  ]);
  if (sectionResult.error) throw sectionResult.error;
  if (!sectionResult.data) return null;
  if (institutionResult.error) throw institutionResult.error;

  const { data: enrolRows, error: enrolError, count } = await supabase
    .from("enrolments")
    .select("student_id, roll_no, students(first_name, last_name, admission_no, dob)", { count: "exact" })
    .eq("institution_id", ctx.institution.id)
    .eq("class_section_id", classSectionId)
    .eq("status", "active")
    .order("roll_no", { ascending: true, nullsFirst: false })
    // PostgREST to-one embed ordering syntax (`order=students(first_name).asc`), sorts the
    // *parent* (enrolments) rows, not just the embedded one — makes the `.limit()` below
    // truncate deterministically on a roll_no tie (most commonly multiple nulls).
    .order("students(first_name)", { ascending: true })
    .limit(ID_CARD_MAX);
  if (enrolError) throw enrolError;

  const rows = sortEnrolments((enrolRows ?? []) as EnrolmentRow[]);
  const totalStudents = count ?? rows.length;
  const studentIds = rows.map((r) => r.student_id);

  const phoneByStudent = new Map<string, string>();
  if (studentIds.length > 0) {
    const { data: guardianRows, error: guardianError } = await supabase
      .from("guardian_students")
      .select("student_id, guardians(phone)")
      .in("student_id", studentIds)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true });
    if (guardianError) throw guardianError;
    for (const g of guardianRows ?? []) {
      if (phoneByStudent.has(g.student_id)) continue;
      const guardian = g.guardians as { phone: string } | null;
      if (guardian) phoneByStudent.set(g.student_id, guardian.phone);
    }
  }

  const photoByStudent = new Map<string, { path: string; mime: string }>();
  let photosSkipped = 0;
  if (studentIds.length > 0) {
    const { data: docRows, error: docError } = await supabase
      .from("documents")
      .select("entity_id, path, mime, size_bytes")
      .eq("institution_id", ctx.institution.id)
      .eq("entity_type", "student")
      .eq("kind", "photo")
      .eq("status", "active")
      .in("entity_id", studentIds)
      .in("mime", ["image/jpeg", "image/png"])
      .order("created_at", { ascending: false });
    if (docError) throw docError;
    for (const doc of docRows ?? []) {
      if (photoByStudent.has(doc.entity_id)) continue; // newest kept first (created_at desc)
      if (doc.size_bytes > ID_CARD_PHOTO_MAX_BYTES) {
        photosSkipped += 1;
        continue;
      }
      photoByStudent.set(doc.entity_id, { path: doc.path, mime: doc.mime });
    }
  }

  const photoDataByStudent = new Map<string, string>();
  await Promise.all(
    [...photoByStudent.entries()].map(async ([studentId, photo]) => {
      const { data: blob, error: downloadError } = await supabase.storage.from(BUCKET).download(photo.path);
      if (downloadError || !blob) return; // failed download -> initials placeholder (rulings: Photo)
      const base64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
      photoDataByStudent.set(studentId, `data:${photo.mime};base64,${base64}`);
    }),
  );

  const grade = sectionResult.data.grades as { code: string } | null;
  const academicYear = sectionResult.data.academic_years as { name: string } | null;
  const classLabel = `${grade?.code ?? "?"}-${sectionResult.data.name}`;

  const cards: IdCard[] = rows.map((row) => ({
    name: [row.students?.first_name, row.students?.last_name].filter(Boolean).join(" ").trim(),
    admissionNo: row.students?.admission_no ?? "",
    dob: row.students?.dob ?? "",
    guardianPhone: phoneByStudent.get(row.student_id) ?? null,
    photoDataUri: photoDataByStudent.get(row.student_id) ?? null,
  }));

  const html = renderIdCardsHtml({
    schoolName: ctx.institution.name,
    board: institutionResult.data.board,
    academicYear: academicYear?.name ?? "",
    classLabel,
    cards,
    totalStudents,
    photosSkipped,
  });

  return { html };
}
