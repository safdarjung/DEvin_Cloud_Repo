import type { Difficulty, QuestionOrigin, QuestionStatus, QuestionType } from "@/modules/question-bank/schemas";

export const TYPES: { value: QuestionType; label: string }[] = [
  { value: "mcq", label: "Multiple choice" },
  { value: "multi_select", label: "Multiple correct answers" },
  { value: "true_false", label: "True or false" },
  { value: "very_short_answer", label: "Very short answer" },
  { value: "short_answer", label: "Short answer" },
  { value: "long_answer", label: "Long answer" },
  { value: "fill_blank", label: "Fill in the blanks" },
  { value: "match", label: "Match the following" },
  { value: "numerical", label: "Numerical" },
  { value: "assertion_reason", label: "Assertion and reason" },
  { value: "case_based", label: "Case-based" },
  { value: "passage", label: "Passage" },
  { value: "diagram", label: "Diagram" },
];
export const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];
export const typeLabel = (t: QuestionType) => TYPES.find((x) => x.value === t)?.label ?? t;

export const STATUS_LABEL: Record<QuestionStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  rejected: "Rejected",
  archived: "Archived",
};
export const STATUS_VARIANT: Record<QuestionStatus, "warning" | "secondary" | "outline" | "success" | "destructive"> = {
  draft: "secondary",
  in_review: "warning",
  approved: "success",
  rejected: "destructive",
  archived: "outline",
};
export const ORIGIN_LABEL: Record<QuestionOrigin, string> = { manual: "Manual", ai: "AI-written", import: "Imported" };

/** Stem types hold shared text; other questions can point at one via stemQuestionId. */
export const isStemType = (t: QuestionType) => t === "passage" || t === "case_based";

export interface TopicOption { id: string; unitId: string; parentId: string | null; title: string }
export interface PairMeta {
  gradeId: string;
  gradeCode: string;
  subjectId: string;
  subjectName: string;
  units: { id: string; title: string }[];
  topics: TopicOption[];
  books: { id: string; title: string }[];
}
export const pairKey = (gradeId: string, subjectId: string) => `${gradeId}:${subjectId}`;
