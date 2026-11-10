import "server-only";
// GU-08 — reads a student's saved style (study_preferences, GU-07), or the
// plan's own defaults (§4: "all on" skills, standard/bullets notes, en)
// when no row exists yet — GU-10 (the editing UI) hasn't shipped, but the
// defaults must work from day one regardless. Only the prompt-relevant
// subset (StudentStyle) is read here; theme/layout/emoji are GU-10/render
// concerns, not needed to build the system prompt.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { STUDENT_LANGUAGES, type StudentSkill, type StudentStyle } from "@/modules/ai/prompts/student-skills";

const DEFAULT_SKILLS: StudentSkill[] = ["terse", "eli5", "anatomy"];
const DEFAULT_STYLE: StudentStyle = { notesDensity: "standard", notesFormat: "bullets", language: "en" };
const KNOWN_SKILLS: readonly StudentSkill[] = ["terse", "eli5", "anatomy"];

export interface StudentPreferences {
  skills: StudentSkill[];
  style: StudentStyle;
}

function isStudentSkill(value: unknown): value is StudentSkill {
  return typeof value === "string" && (KNOWN_SKILLS as readonly string[]).includes(value);
}

export async function getStudentPreferences(ctx: TenantContext): Promise<StudentPreferences> {
  if (!ctx.membership.studentId) return { skills: DEFAULT_SKILLS, style: DEFAULT_STYLE };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("study_preferences")
    .select("skills, style")
    .eq("institution_id", ctx.institution.id)
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { skills: DEFAULT_SKILLS, style: DEFAULT_STYLE };

  // Security review (L2): a student can write this row directly over
  // PostgREST (RLS allows own-row insert/update); deduping here keeps a
  // padded `skills` array (e.g. hundreds of "anatomy" entries, still
  // under the 8 KB column cap) from repeating itself into the system
  // prompt on every single turn.
  const skills = Array.isArray(data.skills) ? [...new Set(data.skills.filter(isStudentSkill))] : DEFAULT_SKILLS;
  const storedStyle = typeof data.style === "object" && data.style !== null ? (data.style as Record<string, unknown>) : {};
  const style: StudentStyle = {
    notesDensity: ["brief", "standard", "detailed"].includes(storedStyle.notesDensity as string)
      ? (storedStyle.notesDensity as StudentStyle["notesDensity"])
      : DEFAULT_STYLE.notesDensity,
    notesFormat: ["bullets", "qa", "paragraphs"].includes(storedStyle.notesFormat as string)
      ? (storedStyle.notesFormat as StudentStyle["notesFormat"])
      : DEFAULT_STYLE.notesFormat,
    language: STUDENT_LANGUAGES.some((l) => l.code === storedStyle.language)
      ? (storedStyle.language as StudentStyle["language"])
      : DEFAULT_STYLE.language,
    myStyle: typeof storedStyle.myStyle === "string" ? storedStyle.myStyle : undefined,
  };

  return { skills, style };
}
