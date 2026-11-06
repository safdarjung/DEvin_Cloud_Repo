import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { meta } from "@/components/marketing/content";
import { RoleCard } from "./role-card";
import { Callout, Container, PageHero } from "@/components/marketing/ui";

export const metadata = meta("Demo", "Try Fabric as a Principal, Administrator, Teacher, Student or Parent on a demo school with sample data.", "/demo");

// Each role maps to one allow-listed demo account (src/lib/auth/demo-accounts.ts).
const D = "@demo.coolskool.test";
const PICK = [
  { role: "Principal", email: `principal${D}`, note: "Institution-wide dashboard." },
  { role: "Administrator", email: `admin${D}`, note: "Students, staff and every module." },
  { role: "Teacher", email: `teacher.x-a${D}`, note: "Class registers and assignments." },
  { role: "Student", email: `student.one${D}`, note: "Assignments and results." },
  { role: "Parent", email: `guardian.one${D}`, note: "Fees, attendance and results for each child." },
];
const DEMO_ON = process.env.NEXT_PUBLIC_DEMO_LOGIN_HINTS === "true";

export default function Page() {
  return (
    <>
      <PageHero eyebrow="Demo" title="Try Fabric as the person who uses it" lead="Pick a role and you are signed in to that role's dashboard on one sample school (St. Joseph's, demo mode). Everything is sample data, kept separate from real schools." />
      <Container className="py-14">
        <ul className="divide-y divide-(color:--mk-line) border-y border-(color:--mk-line)">
          {PICK.map((p) =>
            DEMO_ON ? (
              <RoleCard key={p.role} email={p.email} role={p.role} note={p.note} />
            ) : (
              <li key={p.role}>
                <Link href="/login" className="group flex min-h-14 items-center justify-between gap-4 py-4 focus-visible:outline-2 focus-visible:outline-(color:--mk-accent)">
                  <span>
                    <span className="block font-semibold">{p.role}</span>
                    <span className="block text-sm text-(color:--mk-muted)">{p.note}</span>
                  </span>
                  <ArrowRight className="size-4 text-(color:--mk-accent)" aria-hidden />
                </Link>
              </li>
            ),
          )}
        </ul>
        <Callout>Where demo access is off, these cards open the normal sign-in page. Payments run in Razorpay test mode; email and WhatsApp are simulated.</Callout>
      </Container>
    </>
  );
}
