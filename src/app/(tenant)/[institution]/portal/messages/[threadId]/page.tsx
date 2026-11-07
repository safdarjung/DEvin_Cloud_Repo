import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { uuid } from "@/lib/schemas/common";
import { MessageList } from "@/modules/messaging/components/MessageList";
import { ReplyComposer } from "@/modules/messaging/components/ReplyComposer";
import { myThreads, threadMessages } from "@/modules/messaging/queries";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";

export default async function PortalThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string; threadId: string }>;
  searchParams: Promise<{ student?: string }>;
}) {
  const { institution: institutionSlug, threadId } = await params;
  const { student: studentParam } = await searchParams;
  if (!uuid.safeParse(threadId).success) notFound();
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "message.read");

  const selection = await resolvePortalSelection(ctx, studentParam, `/${institutionSlug}/portal/messages/${threadId}`);
  // Per-child isolation: the thread must belong to the selected child.
  const thread = (await myThreads(ctx, { studentId: selection.studentId })).find((t) => t.id === threadId);
  if (!thread) notFound();
  const messages = await threadMessages(ctx, threadId);
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
      <div className="max-w-3xl space-y-4">
        <div className="border-b-2 border-border pb-3">
          <h2 className="text-base font-semibold">{thread.subject}</h2>
          <p className="text-xs text-muted-foreground">
            {thread.teacherName ?? "Teacher"} · {thread.studentName}
          </p>
        </div>
        <MessageList messages={messages} otherName={thread.teacherName ?? "Teacher"} />
        {canSend && <ReplyComposer institutionSlug={institutionSlug} threadId={threadId} markRead />}
      </div>
    </>
  );
}
