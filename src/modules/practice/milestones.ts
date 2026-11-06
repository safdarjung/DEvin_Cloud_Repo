// Pure: milestones derivable from real attempt data. Only earned ones are returned.
export interface MilestoneInput {
  totalAttempts: number;
  streak: number;
  hasFullMarks: boolean;
}

export function earnedMilestones({ totalAttempts, streak, hasFullMarks }: MilestoneInput): string[] {
  const out: string[] = [];
  if (totalAttempts >= 1) out.push("First practice quiz completed");
  if (totalAttempts >= 10) out.push("10 practice quizzes completed");
  if (hasFullMarks) out.push("Full marks on a practice quiz");
  if (streak >= 7) out.push("7-day practice streak (current)");
  return out;
}
