import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";

// Features-18 #23 — demo learning resources. Needs academics (sections, subject_assignments,
// curriculum_units) and core's teacher/principal logins. Deterministic: fixed uuidV5 ids,
// index-derived fields, service-role insert, no rng draws. link / video / note only (a file row
// needs a documents row plus a storage object). created_by must be explicit (null under the
// service role). 2 sections x 6 subjects x 2-3 resources, a few left as drafts.

const KINDS = [
  { kind: "link", title: "Practice worksheet", url: "https://www.khanacademy.org/", description: "Extra practice for this unit." },
  { kind: "video", title: "Concept explainer video", url: "https://www.youtube.com/", description: "Ten-minute walkthrough." },
  { kind: "note", title: "Revision notes", url: null, description: "Key points to revise before the unit test: definitions, worked examples and common mistakes." },
] as const;

export async function run(ctx: SeedContext): Promise<void> {
  const { data: sections, error: sError } = await ctx.admin
    .from("class_sections")
    .select("id, name, grade_id, grades(code)")
    .eq("institution_id", ctx.institutionId)
    .eq("name", "A");
  if (sError) throw new Error(`resources: sections query failed: ${sError.message}`);
  const owners: Record<string, string | undefined> = { VI: ctx.userIdByLogin["teacher.vi-a"]!, "X": ctx.userIdByLogin["principal"]! };
  const targets = (sections ?? []).filter((s) => Boolean(owners[(s.grades as { code: string } | null)?.code ?? ""])).sort((a, b) => a.id.localeCompare(b.id));
  if (targets.length === 0) throw new Error("resources: no VI-A / X-A sections seeded");

  const resourceRows: Record<string, unknown>[] = [];
  const sectionRows: Record<string, unknown>[] = [];
  for (const section of targets) {
    const code = (section.grades as { code: string }).code;
    const { data: assigned, error: aError } = await ctx.admin
      .from("subject_assignments")
      .select("subject_id")
      .eq("institution_id", ctx.institutionId)
      .eq("class_section_id", section.id)
      .order("subject_id")
      .limit(6);
    if (aError) throw new Error(`resources: subject_assignments query failed: ${aError.message}`);
    const { data: units, error: uError } = await ctx.admin
      .from("curriculum_units")
      .select("id, subject_id")
      .eq("institution_id", ctx.institutionId)
      .eq("grade_id", section.grade_id)
      .order("sequence")
      .order("id");
    if (uError) throw new Error(`resources: curriculum_units query failed: ${uError.message}`);
    const unitBySubject = new Map<string, string>();
    for (const u of units ?? []) if (!unitBySubject.has(u.subject_id)) unitBySubject.set(u.subject_id, u.id);

    (assigned ?? []).forEach((a, si) => {
      const count = 2 + (si % 2);
      for (let k = 0; k < count; k++) {
        const t = KINDS[(si + k) % KINDS.length]!;
        const id = uuidV5("resources", `resource:${code}:${si}:${k}`);
        resourceRows.push({
          id,
          institution_id: ctx.institutionId,
          title: `${t.title} ${k + 1}`,
          kind: t.kind,
          url: t.url,
          subject_id: a.subject_id,
          curriculum_unit_id: unitBySubject.get(a.subject_id) ?? null,
          description: t.description,
          published: (si * 3 + k) % 7 !== 0,
          created_by: owners[code]!,
        });
        sectionRows.push({ resource_id: id, institution_id: ctx.institutionId, class_section_id: section.id });
      }
    });
  }
  await insertBatch(ctx.admin, "resources", resourceRows);
  await insertBatch(ctx.admin, "resource_sections", sectionRows);
}
