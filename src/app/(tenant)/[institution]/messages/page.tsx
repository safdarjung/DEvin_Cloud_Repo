import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { NewThreadForm } from "@/modules/messaging/components/NewThreadForm";
import { ThreadList } from "@/modules/messaging/components/ThreadList";
import { myThreads } from "@/modules/messaging/queries";
import { getStudentProfile, listStudents } from "@/modules/people/queries";
import { uuid } from "@/lib/schemas/common";

export const metadata: Metadata = { title: "Messages" };

export default async function MessagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ q?: string; student?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const { q, student } = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "message.read");
  const canSend = hasPermission(ctx, "message.send");
  const isTeacher = ctx.membership.role === "teacher";
  // The school office writes to any family (migration 0156); a teacher only to families of students they teach.
  const isOffice = ["owner", "principal", "admin"].includes(ctx.membership.role);
  const canCompose = canSend && (isTeacher || isOffice);
  const base = `/${institutionSlug}/messages`;

  const threads = await myThreads(ctx);
  const query = q?.trim();
  const [found, profile] = await Promise.all([
    canSend && query ? listStudents(ctx, query, 1) : Promise.resolve(null),
    canCompose && student && uuid.safeParse(student).success ? getStudentProfile(ctx, student) : Promise.resolve(null),
  ]);
  // Every linked guardian is offered (the RPC only needs the link); those without a portal login are marked, since they cannot read replies yet.
  const guardians = profile?.guardians ?? [];

  return (
    <div>
      <PageHeader
        title="Messages"
        description={
          isTeacher
            ? "Conversations with parents of your students."
            : isOffice
              ? "All parent conversations. Start a message to any parent; you can reply in conversations you started."
              : "All parent-teacher conversations. You can read; only participants can reply."
        }
      />
      <div className={canCompose ? "grid gap-4 lg:grid-cols-3" : undefined}>
        <section aria-label="Inbox" className="min-w-0 lg:col-span-2">
          <ThreadList
            threads={threads}
            basePath={base}
            who={(t) => (isTeacher ? (t.guardianName ?? "Parent") : `${t.guardianName ?? "Parent"} and ${t.teacherName ?? "teacher"}`)}
          />
        </section>

        {canCompose && (
          <Card className="min-w-0 self-start">
            <section aria-labelledby="new-h" className="space-y-3 px-4">
              <h2 id="new-h" className="border-b-2 border-border pb-3 text-[15px] font-semibold">
                New message
              </h2>
              <form method="get" className="flex flex-wrap gap-2 sm:flex-nowrap">
                <Input name="q" defaultValue={query ?? ""} placeholder="Search student by name or admission number" aria-label="Search student" className="min-h-11 sm:min-h-9" />
                <Button type="submit" variant="outline" className="min-h-11 w-full sm:min-h-9 sm:w-auto">
                  Search
                </Button>
              </form>
              {found && found.students.length === 0 && (
                <EmptyState title="No matching student" description="Check the spelling or try the admission number." />
              )}
              {found && found.students.length > 0 && (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {found.students.map((s) => (
                    <li key={s.id}>
                      <Link
                        href={`${base}?q=${encodeURIComponent(query ?? "")}&student=${s.id}`}
                        aria-current={s.id === student ? "true" : undefined}
                        className="flex min-h-12 items-center justify-between gap-3 px-4 py-2 text-sm transition-colors duration-(--duration-fast) hover:bg-accent aria-[current=true]:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <span>{[s.firstName, s.lastName].filter(Boolean).join(" ")}</span>
                        <span className="text-xs text-muted-foreground">
                          {s.admissionNo}
                          {s.gradeName ? ` · ${s.gradeName} ${s.sectionName ?? ""}` : ""}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {profile && (
                <NewThreadForm
                  institutionSlug={institutionSlug}
                  studentId={profile.id}
                  counterpartLabel="Parent"
                  options={guardians.map((g) => ({ id: g.id, label: `${g.fullName} (${g.relationship})${g.hasPortalLogin ? "" : " - no portal login yet"}` }))}
                  threadBase={base}
                />
              )}
            </section>
          </Card>
        )}
      </div>
    </div>
  );
}
