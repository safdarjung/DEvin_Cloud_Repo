import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { NewThreadForm } from "@/modules/messaging/components/NewThreadForm";
import { ThreadList } from "@/modules/messaging/components/ThreadList";
import { messageableTeachers, myThreads } from "@/modules/messaging/queries";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";

export default async function PortalMessagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ student?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const { student: studentParam } = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "message.read");

  const selection = await resolvePortalSelection(ctx, studentParam, `/${institutionSlug}/portal/messages`);
  const [threads, teachers] = await Promise.all([
    myThreads(ctx, { studentId: selection.studentId }),
    messageableTeachers(ctx, selection.studentId),
  ]);
  const canSend = hasPermission(ctx, "message.send");

  return (
    <>
      <PortalNav
        institutionSlug={institutionSlug}
        role={ctx.membership.role as "guardian" | "student"}
        selection={selection}
        activeHref="/messages"
        canStudy={hasPermission(ctx, "ai.study")}
      />
      <div className="space-y-6">
        <section aria-labelledby="threads-h" className="space-y-3">
          <h2 id="threads-h" className="text-base font-semibold">
            Messages about {selection.studentName}
          </h2>
          <ThreadList
            threads={threads}
            basePath={`/${institutionSlug}/portal/messages`}
            query={`?student=${selection.studentId}`}
            who={(t) => t.teacherName ?? "Teacher"}
          />
        </section>
        {canSend && (
          <section aria-labelledby="new-h" className="max-w-xl space-y-3">
            <h2 id="new-h" className="text-base font-semibold">
              New message
            </h2>
            <NewThreadForm
              institutionSlug={institutionSlug}
              studentId={selection.studentId}
              counterpartLabel="Teacher"
              options={teachers.map((t) => ({
                id: t.staffId,
                label: `${t.fullName}${t.isClassTeacher ? " (class teacher)" : ""}${t.subjectNames.length ? ` – ${t.subjectNames.join(", ")}` : ""}`,
              }))}
              threadBase={`/${institutionSlug}/portal/messages`}
              threadQuery={`?student=${selection.studentId}`}
            />
          </section>
        )}
      </div>
    </>
  );
}
