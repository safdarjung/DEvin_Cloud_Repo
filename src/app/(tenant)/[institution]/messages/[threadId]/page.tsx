import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { uuid } from "@/lib/schemas/common";
import { MessageList } from "@/modules/messaging/components/MessageList";
import { ReplyComposer } from "@/modules/messaging/components/ReplyComposer";
import { myThreads, threadMessages } from "@/modules/messaging/queries";

export default async function MessageThreadPage({ params }: { params: Promise<{ institution: string; threadId: string }> }) {
  const { institution: institutionSlug, threadId } = await params;
  if (!uuid.safeParse(threadId).success) notFound();
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "message.read");

  const thread = (await myThreads(ctx)).find((t) => t.id === threadId);
  if (!thread) notFound();
  const messages = await threadMessages(ctx, threadId);

  // Teachers are always participants of threads they can see. Leaders can read
  // every thread but the send RPC only accepts participants: treat a leader as
  // a participant only if they have already written in the thread.
  const isTeacher = ctx.membership.role === "teacher";
  const participant = isTeacher || messages.some((m) => m.mine);
  const canReply = hasPermission(ctx, "message.send") && participant;
  const other = isTeacher ? (thread.guardianName ?? "Parent") : "Participant";

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader
        title={thread.subject}
        description={`${thread.guardianName ?? "Parent"} and ${thread.teacherName ?? "teacher"} · ${thread.studentName}`}
        back={{ href: `/${institutionSlug}/messages`, label: "Messages" }}
      />
      <MessageList messages={messages} otherName={other} />
      {canReply ? (
        <ReplyComposer institutionSlug={institutionSlug} threadId={threadId} markRead />
      ) : (
        <p className="text-sm text-muted-foreground">You are not part of this conversation, so it is read-only.</p>
      )}
    </div>
  );
}
