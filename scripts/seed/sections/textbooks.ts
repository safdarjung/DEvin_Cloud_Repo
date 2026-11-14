import type { SeedContext } from "../lib/context.ts";
import { demoUsers } from "../lib/util.ts";
import { proposeMapping, type CatalogueBook } from "../../../src/modules/textbooks/ncert.ts";

// 0139 demo data: the "Suggest NCERT books" proposal applied to every taught
// (grade, subject) of the demo school (same matcher as the action), plus one
// unit -> chapter link for the X-A demo journey (Grade X Mathematics
// "Quadratic Equations" -> NCERT Class 10 Mathematics, chapter 4). Links to
// ncert.nic.in only; no file is fetched or stored. Insert-if-missing: a pair
// that already has any book is left alone, so reruns add nothing. No rng.

// Pairs NCERT publishes no book for. CBSE IT URLs returned 200 (2026-11-14); the commercial series
// (Touchpad Plus, Cyber Beans, Bumblebee) were seen in retailer listings for some classes only.
// Art I/II/X, Physical Education I/II: no verified book, left unmapped.
const CBSE = "CBSE (Department of Skill Education)";
const IT_URL = "https://cbseacademic.nic.in/web_material/Curriculum25/publication/secondary";
const touchpad = (g: string) => ({ grade: g, subject: "Computer Science", title: `Touchpad Plus, Class ${g}`, publisher: "Orange Education" });
const CUSTOM_BOOKS: { grade: string; subject: string; title: string; publisher: string; url?: string }[] = [
  ...["I", "II", "III", "IV", "V", "VI", "VII", "VIII"].map(touchpad),
  ...["IX", "X"].map((g) => ({ grade: g, subject: "Computer Science", title: "New Cyber Beans Computer Applications (Code 165)", publisher: "Kips Publishing World" })),
  { grade: "IX", subject: "Information Technology", title: "Information Technology (402) Class IX Student Handbook", publisher: CBSE, url: `${IT_URL}/402_IT_IX.pdf` },
  { grade: "X", subject: "Information Technology", title: "Information Technology (402) Class X Student Handbook", publisher: CBSE, url: `${IT_URL}/402_IT_X.pdf` },
  ...["I", "II"].map((g) => ({ grade: g, subject: "Environmental Studies", title: "Bumblebee EVS", publisher: "Collins" })),
];

export async function run(ctx: SeedContext): Promise<void> {
  const inst = ctx.institutionId;
  const users = await demoUsers(ctx.sql, inst);
  const author = users["principal"] ?? users["admin"] ?? Object.values(users)[0];
  if (!author) {
    console.warn("  textbooks: no demo login found; skipped.");
    return;
  }

  const pairs = await ctx.sql<{ grade_id: string; grade_code: string; grade_name: string; subject_id: string; subject_name: string }[]>`
    select distinct cs.grade_id, g.code as grade_code, g.display_name as grade_name, sa.subject_id, s.name as subject_name
    from public.subject_assignments sa
    join public.class_sections cs on cs.id = sa.class_section_id
    join public.grades g on g.id = cs.grade_id
    join public.subjects s on s.id = sa.subject_id
    where sa.institution_id = ${inst}`;
  const rows = await ctx.sql<{ code: string; class_level: number | null; subject: string; title: string; medium: string; chapters_count: number; book_url: string; chapter_pdf_pattern: string; verified: boolean }[]>`
    select code, class_level, subject, title, medium, chapters_count, book_url, chapter_pdf_pattern, verified from public.ncert_textbooks`;
  const catalogue: CatalogueBook[] = rows.map((r) => ({
    code: r.code,
    classLevel: r.class_level,
    subject: r.subject,
    title: r.title,
    medium: r.medium,
    chaptersCount: r.chapters_count,
    bookUrl: r.book_url,
    chapterPdfPattern: r.chapter_pdf_pattern,
    verified: r.verified,
  }));
  const mapped = new Set(
    (await ctx.sql<{ k: string }[]>`select distinct grade_id::text || ':' || subject_id::text as k from public.subject_textbooks where institution_id = ${inst}`).map((r) => r.k),
  );
  const proposal = proposeMapping(
    pairs
      .filter((p) => !mapped.has(`${p.grade_id}:${p.subject_id}`))
      .map((p) => ({ gradeId: p.grade_id, gradeCode: p.grade_code, gradeName: p.grade_name, subjectId: p.subject_id, subjectName: p.subject_name })),
    catalogue,
  );
  const inserts = proposal.flatMap((p) =>
    p.codes.map((code, position) => ({ institution_id: inst, grade_id: p.gradeId, subject_id: p.subjectId, ncert_code: code, position, created_by: author })),
  );
  if (inserts.length) {
    await ctx.sql`insert into public.subject_textbooks ${ctx.sql(inserts, "institution_id", "grade_id", "subject_id", "ncert_code", "position", "created_by")}
      on conflict do nothing`;
  }

  // Custom (non-NCERT) books for pairs that still have none.
  const customRows = pairs.flatMap((p) => {
    const b = CUSTOM_BOOKS.find((c) => c.grade === p.grade_code && c.subject === p.subject_name);
    return b ? [{ institution_id: inst, grade_id: p.grade_id, subject_id: p.subject_id, custom_title: b.title, custom_publisher: b.publisher, custom_url: b.url ?? null, position: 0, created_by: author }] : [];
  });
  const stillMapped = new Set(
    (await ctx.sql<{ k: string }[]>`select distinct grade_id::text || ':' || subject_id::text as k from public.subject_textbooks where institution_id = ${inst}`).map((r) => r.k),
  );
  const customInserts = customRows.filter((r) => !stillMapped.has(`${r.grade_id}:${r.subject_id}`));
  if (customInserts.length) {
    await ctx.sql`insert into public.subject_textbooks ${ctx.sql(customInserts, "institution_id", "grade_id", "subject_id", "custom_title", "custom_publisher", "custom_url", "position", "created_by")}`;
  }

  // Demo journey: X Mathematics "Quadratic Equations" is chapter 4 of NCERT Class 10 Mathematics.
  const [link] = await ctx.sql<{ unit_id: string; grade_id: string; subject_id: string; textbook_id: string }[]>`
    select cu.id as unit_id, cu.grade_id, cu.subject_id, st.id as textbook_id
    from public.curriculum_units cu
    join public.grades g on g.id = cu.grade_id and g.code = 'X'
    join public.subjects s on s.id = cu.subject_id and s.code = 'MATH'
    join public.subject_textbooks st on st.institution_id = cu.institution_id and st.grade_id = cu.grade_id and st.subject_id = cu.subject_id and st.ncert_code = 'jemh1'
    where cu.institution_id = ${inst} and cu.title = 'Quadratic Equations'
    limit 1`;
  if (link) {
    await ctx.sql`insert into public.curriculum_unit_chapters (curriculum_unit_id, institution_id, grade_id, subject_id, subject_textbook_id, chapter_no, created_by)
      values (${link.unit_id}, ${inst}, ${link.grade_id}, ${link.subject_id}, ${link.textbook_id}, 4, ${author})
      on conflict (curriculum_unit_id) do nothing`;
    await ctx.sql`update public.subject_textbooks set chapter_titles = chapter_titles || '{"4": "Quadratic Equations"}'::jsonb
      where id = ${link.textbook_id} and not (chapter_titles ? '4')`;
  }

  const [{ pairs: mappedPairs }] = await ctx.sql<{ pairs: number }[]>`
    select count(distinct (grade_id, subject_id))::int as pairs from public.subject_textbooks where institution_id = ${inst}`;
  console.log(`  textbooks: ${inserts.length + customInserts.length} books added this run; ${mappedPairs} of ${pairs.length} taught (grade, subject) pairs have a book.`);
}
