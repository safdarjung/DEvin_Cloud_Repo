// Pure helpers for the Ask AI panel: page suggestions, page title, orb URL.
// Prompts are plain questions; the AI gateway and its tools still enforce what the role may see.
const BY_SEGMENT: Record<string, readonly string[]> = {
  finance: ["Who has fees overdue?", "Summarise term fee collection.", "Which invoices are unpaid this month?"],
  attendance: ["Who was absent today?", "Which sections are below the attendance threshold?", "Who is repeatedly absent this term?"],
  students: ["Find a student by name or admission number.", "Which students are at risk right now?", "Show a student's attendance pattern."],
  exams: ["Show the grade distribution for the latest exam.", "Which exams are coming up?", "Which students need a recheck review?"],
  admissions: ["How does the admissions funnel look this month?", "Which applications are waiting for review?", "Which enquiries need a follow-up?"],
  timetable: ["Are there any timetable clashes this week?", "Which teachers are overloaded?", "Which rooms are free now?"],
  library: ["Which books are overdue?", "What are the most borrowed titles?", "Who holds the most books?"],
  hostel: ["Who is in each hostel room?", "Which rooms have vacancies?", "Any hostel attendance gaps tonight?"],
  payroll: ["Summarise this month's payroll.", "Who has pending leave or deductions?", "What is the payroll total by department?"],
};
const FALLBACK = ["Give me today's attendance summary.", "What's on the school calendar this week?", "Where in the app can I see fee collection?"];
const MAX = 4;

/** `pathname` is the full path ("/demo/finance/invoices"); the first segment is the school slug. */
export function suggestionsFor(pathname: string): string[] {
  const segment = pathname.split("/").filter(Boolean)[1];
  return [...(BY_SEGMENT[segment ?? ""] ?? FALLBACK)].slice(0, MAX);
}

/** Label of the longest nav href that contains the path, or "this page". */
export function pageTitleFor(pathname: string, items: readonly { href: string; label: string }[]): string {
  const hit = items
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return hit?.label ?? "this page";
}

export function orbUrl(slug: string, from: string, question?: string): string {
  const q = question?.trim();
  return `/${slug}/orb?from=${encodeURIComponent(from)}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
}
