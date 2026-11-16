// Student CSV cleanup before strict validation: schools type what Excel gives them ("Class 5", "Male", 01/05/2014,
// 9.87654E+09), not our enum values. Anything not recognised is passed through so the row schema still reports it.
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
const GENDER: Record<string, string> = { m: "male", male: "male", boy: "male", f: "female", female: "female", girl: "female", other: "other", o: "other" };
const RELATIONSHIP: Record<string, string> = {
  father: "father", dad: "father", mother: "mother", mom: "mother", mum: "mother",
  guardian: "legal_guardian", legal_guardian: "legal_guardian",
  grandparent: "grandparent", grandfather: "grandparent", grandmother: "grandparent", other: "other",
};

function grade(value: string): string {
  const bare = value.trim().replace(/^(class|grade|std|standard)\.?\s*/i, "").trim().toUpperCase();
  if (bare === "NURSERY") return "NUR";
  return /^\d{1,2}$/.test(bare) && ROMAN[Number(bare)] ? ROMAN[Number(bare)] : bare;
}

function dob(value: string): string {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value.trim());
  if (!m) return value;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

function phone(value: string): string {
  let v = value.trim();
  if (/^\d(\.\d+)?e\+?\d+$/i.test(v)) v = Number(v).toFixed(0); // Excel scientific notation
  v = v.replace(/[\s-]/g, "").replace(/^\+?91(?=\d{10}$)/, "").replace(/^0(?=\d{10}$)/, "");
  return v;
}

const lookup = (table: Record<string, string>, value: string) => table[value.trim().toLowerCase().replace(/[\s-]+/g, "_")] ?? value;

export function normalizeStudentRow(raw: Record<string, string>): Record<string, string> {
  const row = { ...raw };
  if (row.gender !== undefined) row.gender = lookup(GENDER, row.gender);
  if (row.guardian_relationship !== undefined) row.guardian_relationship = lookup(RELATIONSHIP, row.guardian_relationship);
  if (row.grade !== undefined) row.grade = grade(row.grade);
  if (row.section !== undefined) row.section = row.section.trim().toUpperCase();
  if (row.dob !== undefined) row.dob = dob(row.dob);
  if (row.guardian_phone !== undefined) row.guardian_phone = phone(row.guardian_phone);
  return row;
}
