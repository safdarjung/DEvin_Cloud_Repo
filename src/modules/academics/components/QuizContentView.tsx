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
        <li key={index} className="rounded-lg border border-border p-3">
          <p className="font-medium">
            {index + 1}. {question.stem}
          </p>
          <ul className="mt-2 space-y-1 pl-4">
            {question.options.map((option) => {
              const isCorrect = showAnswers && option === question.answer;
              return (
                <li
                  key={option}
                  className={isCorrect ? "font-semibold text-primary" : "text-foreground"}
                >
                  {option}
                  {isCorrect ? " (correct)" : null}
                </li>
              );
            })}
          </ul>
          {showAnswers && question.explanation ? (
            <p className="mt-2 text-sm text-muted-foreground">{question.explanation}</p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
