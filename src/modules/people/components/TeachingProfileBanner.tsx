"use client";

// 0155: shown to a teacher on their home (/today) until they save their teaching profile.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { GraduationCap } from "lucide-react";

export function TeachingProfileBanner({ href }: { href: string }) {
  const pathname = usePathname();
  if (pathname !== href.replace(/\/me\/teaching-profile$/, "/today")) return null;
  return (
    <div role="note" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
      <GraduationCap className="size-5 shrink-0 text-primary" aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="font-medium">Welcome. Please fill in your teaching profile.</span> Your qualifications and the subjects and classes you can teach help the office plan classes. It takes about two minutes.
      </p>
      <Link href={href} className="inline-flex min-h-9 items-center rounded-md bg-primary px-3 font-medium text-primary-foreground hover:bg-primary/90">
        Fill it in
      </Link>
    </div>
  );
}
