import "server-only";
// features-18 §C2 — lab safety note: lab id -> the lab's deterministic safety
// check reworded as one short warning. No warnings, a gateway failure, or a
// wording that drops, adds or renames an item all return the deterministic
// text (source "rules"). Reads through school-labs queries; persists nothing.
import { fail, ok, type ActionResult } from "@/lib/actions/result";
import { runStructured } from "@/lib/ai/gateway";
import { todayInInstitutionTimezone } from "@/modules/attendance/queries";
import { schoolLabEquipment, schoolLabs } from "@/modules/school-labs/queries";
import { labSafetyWarnings } from "@/modules/school-labs/safety";
import { aiTaskRoute } from "@/modules/ai/task-route";
import {
  buildLabSafetyNotePrompt,
  deterministicSafetyNote,
  keepsSafetyList,
  LAB_SAFETY_NOTE_INSTRUCTIONS,
  LabSafetyNoteGenerationSchema,
  LabSafetyNoteRequestSchema,
} from "@/modules/ai/lab-safety-note";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One warning <= 500 chars (lesson 9: always cap output).
const MAX_OUTPUT_TOKENS = 512;

interface LabSafetyNoteData {
  note: string;
  source: "ai" | "rules";
  provider: "local" | "cloud" | null;
  model: string | null;
}

export const POST = aiTaskRoute({
  route: "lab-safety-note",
  schema: LabSafetyNoteRequestSchema,
  maxBodyBytes: 4 * 1024,
  permission: "lab.read",
  capability: "lab_safety_note",
  run: async (ctx, input): Promise<ActionResult<LabSafetyNoteData>> => {
    const [labs, equipment] = await Promise.all([schoolLabs(ctx), schoolLabEquipment(ctx, input.labId)]);
    const lab = labs.find((l) => l.id === input.labId);
    if (!lab) return fail("not_found", "Lab not found.");

    // The list schoolLabs.safetyWarnings returns: the same pure check over this register for today.
    const warnings = labSafetyWarnings(equipment, todayInInstitutionTimezone(ctx));
    const rules = ok<LabSafetyNoteData>({ note: deterministicSafetyNote(lab.name, warnings), source: "rules", provider: null, model: null });
    if (warnings.length === 0) return rules;

    const generated = await runStructured({
      ctx,
      feature: "lab_safety_note",
      schema: LabSafetyNoteGenerationSchema,
      instructions: LAB_SAFETY_NOTE_INSTRUCTIONS,
      prompt: buildLabSafetyNotePrompt(lab.name, warnings),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    if (!generated.ok) return rules;
    const warning = generated.data.data.warning;
    if (!keepsSafetyList(warning, lab.name, warnings, equipment.map((e) => e.name))) return rules;
    return ok({ note: warning, source: "ai", provider: generated.data.provider, model: generated.data.model });
  },
});
