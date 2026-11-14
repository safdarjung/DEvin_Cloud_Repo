import { describe, expect, it } from "vitest";
import { marksSheetCsv, readMarksSheet } from "@/modules/exams/marks-sheet";

const students = [
  { studentId: "s1", name: "Aarav Shah", rollNo: 1 },
  { studentId: "s2", name: "Diya Nair", rollNo: 2 },
  { studentId: "s3", name: "Kabir Singh", rollNo: 3 },
];
const current = { s1: { marksObtained: "", isAbsent: false }, s2: { marksObtained: "41", isAbsent: false }, s3: { marksObtained: "", isAbsent: false } };

describe("marksSheetCsv", () => {
  it("lists every student with their current marks, ready for Excel or Google Sheets", () => {
    expect(marksSheetCsv(students, current, 80)).toBe(
      ["Student ID,Roll,Student,Marks (out of 80),Absent (yes/no)", "s1,1,Aarav Shah,,no", "s2,2,Diya Nair,41,no", "s3,3,Kabir Singh,,no"].join("\r\n"),
    );
  });
});

describe("readMarksSheet", () => {
  const header = "Student ID,Roll,Student,Marks (out of 80),Absent (yes/no)";

  it("fills marks and absences by student ID, and leaves rows with nothing typed alone", () => {
    const out = readMarksSheet([header, "s1,1,Aarav Shah,72.5,no", "s2,2,Diya Nair,,no", "s3,3,Kabir Singh,,yes"].join("\n"), students, 80);
    expect(out.rows).toEqual({ s1: { marksObtained: "72.5", isAbsent: false }, s3: { marksObtained: "", isAbsent: true } });
    expect(out.problems).toEqual([]);
  });

  it("matches by roll number, then by name, when the ID column was deleted or emptied", () => {
    const out = readMarksSheet(["Roll,Student,Marks,Absent", "2,,55,", ",kabir singh,60,"].join("\n"), students, 80);
    expect(out.rows).toEqual({ s2: { marksObtained: "55", isAbsent: false }, s3: { marksObtained: "60", isAbsent: false } });
  });

  it("reports marks above the maximum, words in the marks column and unknown students, by sheet row", () => {
    const out = readMarksSheet([header, "s1,1,Aarav Shah,95,no", "s2,2,Diya Nair,forty,no", "x9,9,New Kid,30,no"].join("\n"), students, 80);
    expect(out.rows).toEqual({});
    expect(out.problems).toEqual([
      "Row 2 (Aarav Shah): 95 is more than 80.",
      "Row 3 (Diya Nair): \"forty\" is not a number.",
      "Row 4: no student in this class matches \"New Kid\".",
    ]);
  });

  it("refuses a file without a marks column", () => {
    expect(readMarksSheet("Name,Score\nA,1", students, 80)).toEqual({ rows: {}, problems: ["The sheet needs a Marks column. Download the sheet from this page and fill that in."] });
  });
});
