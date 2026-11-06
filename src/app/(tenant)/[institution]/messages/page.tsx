import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { NewThreadForm } from "@/modules/messaging/components/NewThreadForm";
import { ThreadList } from "@/modules/messaging/components/ThreadList";
import { myThreads } from "@/modules/messaging/queries";
import { getStudentProfile, listStudents } from "@/modules/people/queries";
import { uuid } from "@/lib/schemas/common";

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
  const base = `/${institutionSlug}/messages`;

  const threads = await myThreads(ctx);
  const query = q?.trim();
  const [found, profile] = await Promise.all([
    canSend && query ? listStudents(ctx, query, 1) : Promise.resolve(null),
    canSend && isTeacher && student && uuid.safeParse(student).success ? getStudentProfile(ctx, student) : Promise.resolve(null),
  ]);
  // Guardians with no portal login cannot read replies, so they are not offered.
  const guardians = profile?.guardians.filter((g) => g.hasPortalLogin) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Messages"
        description={isTeacher ? "Conversations with parents of your students." : "All parent-teacher conversations. You can read; only participants can reply."}
      />
      <ThreadList
        threads={threads}
        basePath={base}
        who={(t) => (isTeacher ? (t.guardianName ?? "Parent") : `${t.guardianName ?? "Parent"} and ${t.teacherName ?? "teacher"}`)}
      />

      {canSend && isTeacher && (
        <section aria-labelledby="new-h" className="max-w-xl space-y-3">
          <h2 id="new-h" className="text-base font-semibold">
            New message
          </h2>
          <form method="get" className="flex gap-2">
            <Input name="q" defaultValue={query ?? ""} placeholder="Search student by name or admission number" aria-label="Search student" />
            <Button type="submit" variant="outline" className="min-h-10">
              Search
            </Button>
          </form>
          {found && found.students.length === 0 && (
            <EmptyState title="No matching student" description="Check the spelling or try the admission number." />
          )}
          {found && found.students.length > 0 && (
            <ul className="divide-y rounded-xl border">
              {found.students.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`${base}?q=${encodeURIComponent(query ?? "")}&student=${s.id}`}
                    aria-current={s.id === student ? "true" : undefined}
                    className="flex min-h-12 items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-muted"
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
              options={guardians.map((g) => ({ id: g.id, label: `${g.fullName} (${g.relationship})` }))}
              threadBase={base}
            />
          )}
        </section>
      )}
    </div>
  );
}
