// Pure: a paper's marks as a spreadsheet (CSV) a teacher fills in Excel or Google Sheets, and the
// filled sheet read back into marks-entry rows. Nothing is saved here: the grid shows what the sheet
// filled and the teacher presses Save (enterMarks validates again on the server).
import Papa from "papaparse";

export interface SheetStudent {
  studentId: string;
  name: string;
  rollNo: number | null;
}

export interface SheetRow {
  marksObtained: string;
  isAbsent: boolean;
}

const YES = new Set(["yes", "y", "true", "1", "a", "ab", "absent"]);

export function marksSheetCsv(students: readonly SheetStudent[], current: Readonly<Record<string, SheetRow>>, maxMarks: number): string {
  return Papa.unparse(
    {
      fields: ["Student ID", "Roll", "Student", `Marks (out of ${maxMarks})`, "Absent (yes/no)"],
      data: students.map((s) => [s.studentId, s.rollNo ?? "", s.name, current[s.studentId]?.marksObtained ?? "", current[s.studentId]?.isAbsent ? "yes" : "no"]),
    },
    { newline: "\r\n" },
  );
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Rows the sheet fills (by student ID, else roll number, else exact name) and the problems found, by sheet row (header = row 1). */
export function readMarksSheet(text: string, students: readonly SheetStudent[], maxMarks: number): { rows: Record<string, SheetRow>; problems: string[] } {
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), { skipEmptyLines: true });
  const [head = [], ...body] = parsed.data;
  const col = (re: RegExp) => head.findIndex((h) => re.test(norm(h)));
  const at = { id: col(/^student id$/), roll: col(/^roll/), name: col(/^(student|student name|name)$/), marks: col(/^marks/), absent: col(/^absent/) };
  if (at.marks < 0) return { rows: {}, problems: ["The sheet needs a Marks column. Download the sheet from this page and fill that in."] };

  const byId = new Map(students.map((s) => [s.studentId, s]));
  const byRoll = new Map(students.flatMap((s) => (s.rollNo == null ? [] : [[String(s.rollNo), s] as const])));
  const byName = new Map(students.map((s) => [norm(s.name), s]));
  const rows: Record<string, SheetRow> = {};
  const problems: string[] = [];

  body.forEach((cells, i) => {
    const cell = (k: keyof typeof at) => (at[k] < 0 ? "" : (cells[at[k]] ?? "").trim());
    const line = i + 2;
    const student = byId.get(cell("id")) ?? byRoll.get(cell("roll")) ?? byName.get(norm(cell("name")));
    if (!student) {
      problems.push(`Row ${line}: no student in this class matches "${cell("name") || cell("roll") || cell("id")}".`);
      return;
    }
    const absent = YES.has(norm(cell("absent")));
    const marks = cell("marks");
    if (absent) {
      rows[student.studentId] = { marksObtained: "", isAbsent: true };
      return;
    }
    if (marks === "") return;
    const n = Number(marks);
    if (!Number.isFinite(n)) problems.push(`Row ${line} (${student.name}): "${marks}" is not a number.`);
    else if (n < 0 || n > maxMarks) problems.push(`Row ${line} (${student.name}): ${marks} is ${n < 0 ? "below 0" : `more than ${maxMarks}`}.`);
    else rows[student.studentId] = { marksObtained: String(n), isAbsent: false };
  });
  return { rows, problems };
}
