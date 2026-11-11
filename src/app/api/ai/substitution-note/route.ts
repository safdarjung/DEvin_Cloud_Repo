import "server-only";
// features-18 §C2 — substitution handover note: substitution id -> a short
// note for the substitute from the class's latest lesson plan + latest
// diary entry for that section and subject (owner queries only). With
// neither on record, a deterministic "no plan on record" note comes back
// and no model is called. Student names in the plan/diary text are redacted
// before the prompt is built. Persists nothing; the note is copied by hand.
import { ok, fail, type ActionResult } from "@/lib/actions/result";
import { runStructured } from "@/lib/ai/gateway";
import { redact } from "@/lib/ai/redact";
import { curriculumLessonPlans } from "@/modules/academics/curriculum.queries";
import { todayInInstitutionTimezone } from "@/modules/attendance/queries";
import { diaryForSection } from "@/modules/diary/queries";
import { listStudents } from "@/modules/people/queries";
import { timetableSubstitutions } from "@/modules/timetable/substitution.queries";
import { aiTaskRoute } from "@/modules/ai/task-route";
import { noPlanNote, pickLessonPlan, SubstitutionNoteGenerationSchema, SubstitutionNoteRequestSchema } from "@/modules/ai/task-drafts";
import { buildSubstitutionNotePrompt, SUBSTITUTION_NOTE_INSTRUCTIONS } from "@/modules/ai/prompts/task-drafts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One note <= 500 chars (lesson 9: always cap output).
const MAX_OUTPUT_TOKENS = 1024;
const MAX_TEXT_CHARS = 1000;

/** provider/model are null for the deterministic no-plan note (no model was called). */
interface SubstitutionNoteData {
  note: string;
  provider: "local" | "cloud" | null;
  model: string | null;
  fallback: boolean;
}

export const POST = aiTaskRoute({
  route: "substitution-note",
  schema: SubstitutionNoteRequestSchema,
  maxBodyBytes: 4 * 1024,
  permission: "timetable.manage", // the Substitutions tab's own gate (staff page)
  capability: "substitution_note",
  run: async (ctx, input): Promise<ActionResult<SubstitutionNoteData>> => {
    const today = todayInInstitutionTimezone(ctx);
    // shortcut: today's substitutions only (the tab's scope); take a date when a dated cover view exists.
    const sub = (await timetableSubstitutions(ctx, today)).find((s) => s.id === input.substitutionId);
    if (!sub) return fail("not_found", "Substitution not found.");

    const slot = { sectionName: sub.section.name, subjectName: sub.subject?.name ?? "the period", periodName: sub.period.name };
    const deterministic = () => ok({ note: noPlanNote(slot), provider: null, model: null, fallback: false });
    if (!sub.subject) return deterministic();
    const subjectId = sub.subject.id;

    const [plans, diary] = await Promise.all([
      curriculumLessonPlans(ctx, { classSectionId: sub.section.id, subjectId }),
      diaryForSection(ctx, sub.section.id),
    ]);
    const plan = pickLessonPlan(plans, today);
    const entry = diary.find((e) => e.subject?.id === subjectId && e.entryDate <= today) ?? null;
    if (!plan && !entry) return deterministic();

    // shortcut: first 50 active students of the section; page further if larger sections leak names.
    const roster = await listStudents(ctx, undefined, 1, { sectionId: sub.section.id, status: "active" });
    const denyNames = roster.students.flatMap((s) => [s.firstName, s.lastName ?? ""]).filter((n) => n.trim().length >= 2);
    const clean = (text: string) => redact(text.slice(0, MAX_TEXT_CHARS), denyNames).text;

    const prompt = buildSubstitutionNotePrompt({
      ...slot,
      plan: plan && { plannedOn: plan.plannedOn, title: clean(plan.title), objectives: clean(plan.objectives), resources: plan.resources && clean(plan.resources) },
      diary: entry && { entryDate: entry.entryDate, body: clean(entry.body), dueDate: entry.dueDate },
    });

    const generated = await runStructured({
      ctx,
      feature: "substitution_note",
      schema: SubstitutionNoteGenerationSchema,
      instructions: SUBSTITUTION_NOTE_INSTRUCTIONS,
      prompt,
      denyNames,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    if (!generated.ok) return generated;

    const { provider, model, fallback } = generated.data;
    return ok({ note: generated.data.data.note, provider, model, fallback });
  },
});
