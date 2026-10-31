import { Badge } from "@/components/ui/badge";
import type { QuizContent } from "@/modules/academics/assignments.schemas";

interface QuizContentViewProps {
  content: QuizContent;
  /** Teacher/owner/principal see answers; guardians/students never do (acceptance criterion 3). */
  showAnswers: boolean;
}

/** Read-only quiz rendering — never editable here; editing happens in AssignmentForm while the assignment is still a draft. */
export function QuizContentView({ content, showAnswers }: QuizContentViewProps) {
  return (
    <ol className="space-y-4">
      {content.questions.map((question, index) => (
        <li key={index} className="space-y-2 rounded-xl border border-border p-4">
          <p className="font-medium">
            {index + 1}. {question.stem}
          </p>
          <ul className="space-y-1.5">
            {question.options.map((option) => {
              const isCorrect = showAnswers && option === question.answer;
              return (
                <li key={option} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-foreground">{option}</span>
                  {isCorrect ? <Badge variant="success">Correct</Badge> : null}
                </li>
              );
            })}
          </ul>
          {showAnswers && question.explanation ? (
            <p className="text-muted-foreground text-sm">{question.explanation}</p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
