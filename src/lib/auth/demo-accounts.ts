import type { LucideIcon } from "lucide-react";
import {
  Banknote,
  ClipboardList,
  GraduationCap,
  ShieldCheck,
  UserCircle,
  Users,
  UserCog,
} from "lucide-react";

// 11 §3 — named demo logins (passwords are never hardcoded; SEED_DEMO_PASSWORD
// only). Shared by the login page's one-click picker and the demoLogin
// action so the two can never drift apart.
export interface DemoAccount {
  email: string;
  name: string;
  role: string;
  /** One line on what this login is for in the demo script (11 §10). */
  blurb: string;
  group: "Leadership" | "Office staff" | "Teachers" | "Families";
  icon: LucideIcon;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    email: "principal@demo.coolskool.test",
    name: "Principal",
    role: "Principal",
    blurb: "Dashboard — attendance, collections, admissions, results, all at once",
    group: "Leadership",
    icon: ShieldCheck,
  },
  {
    email: "admin@demo.coolskool.test",
    name: "Admin",
    role: "School admin",
    blurb: "Full access — students, staff, every module",
    group: "Leadership",
    icon: UserCog,
  },
  {
    email: "admissions@demo.coolskool.test",
    name: "Admissions",
    role: "Admissions office",
    blurb: "Enquiries, applications, the decision trail, enrolment",
    group: "Office staff",
    icon: ClipboardList,
  },
  {
    email: "accountant@demo.coolskool.test",
    name: "Accountant",
    role: "Accountant",
    blurb: "Invoices, payments, receipts, the ledger",
    group: "Office staff",
    icon: Banknote,
  },
  {
    email: "examcontroller@demo.coolskool.test",
    name: "Exam controller",
    role: "Exam controller",
    blurb: "Marks entry, verification, publishing, rechecks",
    group: "Office staff",
    icon: GraduationCap,
  },
  {
    email: "teacher.vi-a@demo.coolskool.test",
    name: "Teacher · VI-A",
    role: "Class teacher, VI-A",
    blurb: "Today's VI-A attendance register",
    group: "Teachers",
    icon: Users,
  },
  {
    email: "teacher.viii-b@demo.coolskool.test",
    name: "Teacher · VIII-B",
    role: "Class teacher, VIII-B",
    blurb: "Today's VIII-B attendance register",
    group: "Teachers",
    icon: Users,
  },
  {
    email: "teacher.x-a@demo.coolskool.test",
    name: "Teacher · X-A Maths",
    role: "Mathematics, X-A",
    blurb: "Assignments — AI drafts a quiz, this teacher decides",
    group: "Teachers",
    icon: Users,
  },
  {
    email: "guardian.one@demo.coolskool.test",
    name: "Priya Sharma",
    role: "Parent — Aarav (VI-A), Ananya (X-A)",
    blurb: "Two children in one portal: fees, attendance, results",
    group: "Families",
    icon: UserCircle,
  },
  {
    email: "guardian.two@demo.coolskool.test",
    name: "Rohit Mehta",
    role: "Parent — Ishaan (VIII-B)",
    blurb: "A second family, a second phone number",
    group: "Families",
    icon: UserCircle,
  },
  {
    email: "student.one@demo.coolskool.test",
    name: "Ananya Sharma",
    role: "Student, X-A",
    blurb: "A student's own view: assignments and results",
    group: "Families",
    icon: UserCircle,
  },
];

export const DEMO_ACCOUNT_EMAILS: readonly string[] = DEMO_ACCOUNTS.map((a) => a.email);

export const DEMO_ACCOUNT_GROUPS: readonly DemoAccount["group"][] = [
  "Leadership",
  "Office staff",
  "Teachers",
  "Families",
];
