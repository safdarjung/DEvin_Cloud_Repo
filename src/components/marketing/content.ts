import type { Metadata } from "next";
import type { Row } from "./ui";

export const NAV = [
  { href: "/product", label: "Product" },
  { href: "/modules", label: "Modules" },
  { href: "/ai", label: "AI" },
  { href: "/security", label: "Security" },
  { href: "/pricing", label: "Pricing" },
  { href: "/roles", label: "Roles" },
  { href: "/tour", label: "Tour" },
] as const;

export const NAV_MORE = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/faq", label: "FAQ" },
  { href: "/demo", label: "Try the demo" },
] as const;

export const LEGAL = [
  { href: "/legal/privacy", label: "Privacy" },
  { href: "/legal/terms", label: "Terms" },
  { href: "/legal/cookies", label: "Cookies" },
  { href: "/legal/data-processing", label: "Data processing" },
  { href: "/legal/acceptable-use", label: "Acceptable use" },
] as const;

export function meta(title: string, description: string, path: string): Metadata {
  return { title, description, alternates: { canonical: path }, openGraph: { title, description, url: path, type: "website" } };
}

export const MODULES: readonly Row[] = [
  { title: "Admissions", body: "Public enquiry form, applications, a recorded decision trail, and enrolment into the student record." },
  { title: "Attendance", body: "Daily class registers for teachers, with absences visible to the office and to the guardian." },
  { title: "Fees and receipts", body: "Invoices, payments, receipts and a ledger. Online payment runs in Razorpay test mode only; without keys, payments are simulated.", tag: "Test mode" },
  { title: "Exams and results", body: "Marks entry, verification, publishing and rechecks. Published results are versioned: corrections add a new version, they never overwrite.", },
  { title: "Assignments", body: "Teachers set and review work for their classes; students and guardians see their own." },
  { title: "Website CMS", body: "A public school website managed from inside Fabric. Only published content is ever served." },
  { title: "Notifications", body: "Announcements and reminders. Email and WhatsApp are simulated until provider keys are configured for your institution.", tag: "Simulated until configured" },
  { title: "AI assistant", body: "Answers and drafts inside the permissions of the person asking. Your institution chooses whether models run in the cloud or locally." },
  { title: "Insights, forecasts and agents", body: "Surfaces what needs attention. Anything that changes records waits for a person to approve it." },
  { title: "Audit log", body: "Sensitive actions are recorded as append-only events you can review." },
];

export const ROLES: readonly { role: string; summary: string; sees: string[] }[] = [
  { role: "Principal", summary: "One view across the institution.", sees: ["Attendance, collections, admissions and results together", "Insights and AI suggestions awaiting a decision", "Approvals that need leadership sign-off"] },
  { role: "Administrator", summary: "Runs the system day to day.", sees: ["Students, staff and guardians", "Module settings and AI policy", "Audit log"] },
  { role: "Teacher", summary: "Class work without the paperwork.", sees: ["Own class registers", "Assignments, with AI drafts the teacher accepts or discards", "Marks entry for assigned subjects"] },
  { role: "Student", summary: "Their own record, nothing else.", sees: ["Assignments", "Published results", "Attendance"] },
  { role: "Parent", summary: "Every child in one portal.", sees: ["Fees and receipts", "Attendance and published results", "Notices from the school"] },
];

export const FAQ: readonly { q: string; a: string }[] = [
  { q: "What is Fabric?", a: "An operating system for educational institutions: admissions, attendance, fees, exams, assignments, website, notifications and an AI layer in one multi-tenant platform." },
  { q: "Do payments work today?", a: "Online payments are wired to Razorpay in test mode only. Without keys they are simulated. Live payments need configuration and review for your institution." },
  { q: "Do emails and WhatsApp messages actually send?", a: "Not until provider keys are configured. Until then those channels are simulated and labelled as such in the product." },
  { q: "Can the AI change marks, payments or access?", a: "No. AI output is a suggestion. A person saves or approves it. AI never writes marks, payments, access or welfare decisions." },
  { q: "Where do AI models run?", a: "Your institution sets a policy: cloud models, or local-only, in which case no cloud provider is used." },
  { q: "How is one institution's data kept from another's?", a: "Every record carries its institution, and row-level security in the database enforces it independently of the application code." },
  { q: "Is there a mobile app?", a: "Native apps are planned, not built. The web app works in a mobile browser." },
  { q: "Can we bring our own AI key, or buy AI credits?", a: "Planned, not available yet." },
  { q: "What does it cost?", a: "Plans are quoted per institution. See the pricing page for how we scope a quote." },
  { q: "Which certifications do you hold?", a: "None are claimed on this site. Security controls are described on the security page; ask us for detail during a demo." },
];
