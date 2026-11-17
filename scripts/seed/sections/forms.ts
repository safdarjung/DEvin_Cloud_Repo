import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";

// Features-18 #13 — demo forms. Deterministic (fixed uuidV5 ids, index-derived answers, service-role
// insert), no ctx.rng draws. 5 forms (1 draft, 3 published, 1 closed) addressed to VI-A and X-A;
// responses come from guardian.one / guardian.two for their enrolled children and from student.one.

type Field =
  | { type: "text"; label: string; required?: boolean }
  | { type: "consent"; label: string; required?: boolean }
  | { type: "choice"; label: string; required?: boolean; options: string[] };

const FORMS: { key: string; title: string; description: string; status: "draft" | "published" | "closed"; fields: Field[] }[] = [
  {
    key: "trip",
    title: "Annual field trip consent",
    description: "Day trip to the science museum on 20 December.",
    status: "published",
    fields: [
      { type: "consent", label: "I allow my child to join the field trip and travel by school bus.", required: true },
      { type: "choice", label: "Meal preference", required: true, options: ["Vegetarian", "Non-vegetarian", "Jain"] },
      { type: "text", label: "Allergies or medical notes the teacher should know" },
    ],
  },
  {
    key: "photo",
    title: "Photo and video consent",
    description: "Used for the school website and yearbook.",
    status: "closed",
    fields: [
      { type: "consent", label: "I allow photos and videos of my child on school channels.", required: true },
      { type: "consent", label: "I allow my child's first name beside the photo." },
    ],
  },
  {
    key: "contact",
    title: "Emergency contact check",
    description: "Confirm who we should call first.",
    status: "published",
    fields: [
      { type: "text", label: "Primary emergency phone number", required: true },
      { type: "choice", label: "Best time to call", options: ["Morning", "Afternoon", "Evening"] },
    ],
  },
  {
    key: "club",
    title: "Weekend club interest",
    description: "Tell us which weekend activity your child would join.",
    status: "published",
    fields: [
      { type: "choice", label: "Preferred club", required: true, options: ["Chess", "Football", "Art", "Robotics", "Music"] },
      { type: "text", label: "Anything else we should plan for?" },
    ],
  },
  {
    key: "uniform",
    title: "Winter uniform sizes (draft)",
    description: "Not yet sent.",
    status: "draft",
    fields: [
      { type: "choice", label: "Blazer size", required: true, options: ["S", "M", "L", "XL"] },
      { type: "consent", label: "I accept the uniform charges added to the fee account." },
    ],
  },
];

// Text answers match the question: phone numbers only for phone/contact fields.
const TEXTS = ["No allergies.", "Peanut allergy, carries medication.", "Dust allergy.", "None"];
const PHONES = ["9876500011", "9876500022", "9876500033"];

function answer(f: Field, n: number): unknown {
  if (f.type === "consent") return f.required ? true : n % 3 !== 0;
  if (f.type === "choice") return n % f.options.length;
  const pool = /phone|contact|mobile/i.test(f.label) ? PHONES : TEXTS;
  return f.required || n % 2 === 0 ? pool[n % pool.length]! : null;
}

export async function run(ctx: SeedContext): Promise<void> {
  const { data: sections, error: secError } = await ctx.admin
    .from("class_sections")
    .select("id, name, grades(code)")
    .eq("institution_id", ctx.institutionId);
  if (secError) throw secError;
  const audience = (sections ?? [])
    .filter((s) => ["VI-A", "X-A"].includes(`${(s.grades as { code: string } | null)?.code}-${s.name}`))
    .map((s) => s.id);
  if (audience.length === 0) throw new Error("forms: no VI-A / X-A sections seeded");

  const author = ctx.userIdByLogin["principal"]!;
  const formRows = FORMS.map((f, i) => ({
    id: uuidV5("forms", `form:${f.key}`),
    institution_id: ctx.institutionId,
    title: f.title,
    description: f.description,
    fields: f.fields,
    status: f.status,
    published_at: f.status === "draft" ? null : `2026-11-0${i + 1}T09:00:00+05:30`,
    published_by: f.status === "draft" ? null : author,
    closed_at: f.status === "closed" ? "2026-11-08T18:00:00+05:30" : null,
    created_by: author,
  }));
  await insertBatch(ctx.admin, "forms", formRows);
  await insertBatch(
    ctx.admin,
    "form_sections",
    formRows.flatMap((f) => audience.map((class_section_id) => ({ form_id: f.id, institution_id: ctx.institutionId, class_section_id }))),
  );

  // One response per (form, respondent, child): each demo guardian answers for the children linked to them.
  const responders = ["guardian.one", "guardian.two"].flatMap((login) => (ctx.userIdByLogin[login] ? [{ login, userId: ctx.userIdByLogin[login]! }] : []));
  const rows: Record<string, unknown>[] = [];
  let n = 0;
  for (const r of responders) {
    const { data: links, error } = await ctx.admin
      .from("guardian_students")
      .select("student_id")
      .eq("institution_id", ctx.institutionId)
      .eq("guardian_id", ctx.linkIdByLogin[r.login]!)
      .order("student_id")
      .limit(3);
    if (error) throw error;
    for (const link of links ?? []) {
      for (const f of formRows) {
        if (f.status === "draft") continue;
        const def = FORMS.find((x) => uuidV5("forms", `form:${x.key}`) === f.id)!;
        rows.push({
          id: uuidV5("forms", `response:${f.id}:${r.userId}:${link.student_id}`),
          institution_id: ctx.institutionId,
          form_id: f.id,
          respondent_user_id: r.userId,
          student_id: link.student_id,
          answers: def.fields.map((fld) => answer(fld, n++)),
          created_at: `2026-11-0${(n % 6) + 2}T1${n % 10}:00:00+05:30`,
        });
      }
    }
  }
  if (rows.length > 0) await insertBatch(ctx.admin, "form_responses", rows);
}
