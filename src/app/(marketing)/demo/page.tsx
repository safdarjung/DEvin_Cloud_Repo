import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { meta } from "@/components/marketing/content";
import { Callout, Container, PageHero } from "@/components/marketing/ui";

export const metadata = meta("Demo", "Try Fabric as a Principal, Administrator, Teacher, Student or Parent on a demo school with sample data.", "/demo");

// Each role maps to a demo account on /login (src/lib/auth/demo-accounts.ts).
const PICK = [
  { role: "Principal", note: "Institution-wide dashboard." },
  { role: "Administrator", note: "Students, staff and every module." },
  { role: "Teacher", note: "Class registers and assignments." },
  { role: "Student", note: "Assignments and results." },
  { role: "Parent", note: "Fees, attendance and results for each child." },
];

export default function Page() {
  return (
    <>
      <PageHero eyebrow="Demo" title="Try Fabric as the person who uses it" lead="Pick a role. You will land on the sign-in page, where the demo accounts are one tap each. Everything is sample data on a demo school." />
      <Container className="py-14">
        <ul className="divide-y divide-(color:--mk-line) border-y border-(color:--mk-line)">
          {PICK.map((p) => (
            <li key={p.role}>
              <Link href="/login?switch=1" className="group flex min-h-14 items-center justify-between gap-4 py-4 focus-visible:outline-2 focus-visible:outline-(color:--mk-accent)">
                <span>
                  <span className="block font-semibold">{p.role}</span>
                  <span className="block text-sm text-(color:--mk-muted)">{p.note}</span>
                </span>
                <ArrowRight className="size-4 text-(color:--mk-accent) transition-transform group-hover:translate-x-1 motion-reduce:transition-none" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
        <Callout>The sign-in page shows quick demo buttons only when demo access is enabled on this deployment. Payments run in Razorpay test mode; email and WhatsApp are simulated.</Callout>
      </Container>
    </>
  );
}
