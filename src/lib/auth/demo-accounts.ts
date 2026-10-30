// 11 §3 — named demo logins (passwords are never hardcoded; SEED_DEMO_PASSWORD
// only). Shared by the login page's hint list and the one-click demo-login
// action so the two can never drift apart.
export const DEMO_ACCOUNT_EMAILS: readonly string[] = [
  "principal@demo.coolskool.test",
  "admin@demo.coolskool.test",
  "admissions@demo.coolskool.test",
  "accountant@demo.coolskool.test",
  "examcontroller@demo.coolskool.test",
  "teacher.vi-a@demo.coolskool.test",
  "teacher.viii-b@demo.coolskool.test",
  "teacher.x-a@demo.coolskool.test",
  "guardian.one@demo.coolskool.test",
  "guardian.two@demo.coolskool.test",
  "student.one@demo.coolskool.test",
];

export const DEMO_ACCOUNT_LABELS: Record<string, string> = {
  "principal@demo.coolskool.test": "Principal",
  "admin@demo.coolskool.test": "Admin",
  "admissions@demo.coolskool.test": "Admissions",
  "accountant@demo.coolskool.test": "Accountant",
  "examcontroller@demo.coolskool.test": "Exam controller",
  "teacher.vi-a@demo.coolskool.test": "Teacher — VI-A (class teacher)",
  "teacher.viii-b@demo.coolskool.test": "Teacher — VIII-B (class teacher)",
  "teacher.x-a@demo.coolskool.test": "Teacher — X-A (Mathematics)",
  "guardian.one@demo.coolskool.test": "Parent — Priya Sharma (Aarav VI-A, Ananya X-A)",
  "guardian.two@demo.coolskool.test": "Parent — Rohit Mehta (Ishaan VIII-B)",
  "student.one@demo.coolskool.test": "Student — Ananya Sharma",
};
