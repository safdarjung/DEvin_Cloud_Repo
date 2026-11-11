// F18 §H step 3 — deterministic header → import-column matcher. Exact match
// (case/space/punctuation-insensitive) first, then a small alias table. AI for
// leftovers is another packet; unmatched headers map to null for manual choice.
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const ALIASES: Record<string, readonly string[]> = {
  admission_no: ["admno", "admissionnumber", "admissionid", "admission", "admnumber", "regno", "registrationno"],
  first_name: ["firstname", "fname", "givenname", "studentname", "name"],
  last_name: ["lastname", "surname", "lname", "familyname"],
  dob: ["dateofbirth", "birthdate", "birthday", "dateofbirth"],
  gender: ["sex"],
  grade: ["class", "std", "standard", "classname"],
  section: ["sec", "division", "div"],
  roll_no: ["rollnumber", "roll", "rollno"],
  guardian_name: ["fathername", "parentname", "guardian", "parent", "mothername", "fathersname"],
  guardian_phone: ["mobile", "phone", "contact", "mobileno", "phoneno", "contactno", "parentphone", "parentmobile", "guardianmobile", "fathermobile"],
  guardian_email: ["email", "parentemail", "emailid"],
  guardian_relationship: ["relationship", "relation", "relationwithstudent"],
  employee_no: ["empno", "employeeid", "employeenumber", "staffid", "empid", "staffno"],
  full_name: ["name", "staffname", "employeename", "fullname"],
  designation: ["role", "post", "position", "title"],
  department: ["dept", "departmentname"],
  phone: ["mobile", "contact", "mobileno", "phoneno", "contactno"],
  email: ["emailid", "mailid", "emailaddress"],
  is_teaching: ["teaching", "teacher", "isteacher", "teachingstaff"],
};

/** header → import column (or null). Each column is claimed by at most one header. */
export function suggestColumnMapping(headers: readonly string[], columns: readonly string[]): Record<string, string | null> {
  const result: Record<string, string | null> = Object.fromEntries(headers.map((h) => [h, null]));
  const taken = new Set<string>();
  const pass = (matches: (header: string, column: string) => boolean) => {
    for (const header of headers) {
      if (result[header] !== null) continue;
      const column = columns.find((c) => !taken.has(c) && matches(norm(header), c));
      if (column) {
        result[header] = column;
        taken.add(column);
      }
    }
  };
  pass((h, c) => h === norm(c));
  pass((h, c) => (ALIASES[c] ?? []).includes(h));
  return result;
}

/** Required columns not yet claimed by any header. */
export function unmappedColumns(mapping: Record<string, string | null>, columns: readonly string[]): string[] {
  const used = new Set(Object.values(mapping));
  return columns.filter((c) => !used.has(c));
}
