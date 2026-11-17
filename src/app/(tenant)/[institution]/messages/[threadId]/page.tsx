import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/schemas/common";
import { MessageList } from "@/modules/messaging/components/MessageList";
import { ReplyComposer } from "@/modules/messaging/components/ReplyComposer";
import { myThreads, threadMessages } from "@/modules/messaging/queries";

export const metadata: Metadata = { title: "Conversation" };

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

  // Leaders are not a side of the thread: name each sender from the guardian and teacher on it (where RLS lets them read it).
  const senderNames: Record<string, string> = {};
  if (!isTeacher) {
    const supabase = await createClient();
    const { data: t } = await supabase.from("message_threads").select("guardian_id, teacher_staff_id").eq("id", threadId).eq("institution_id", ctx.institution.id).maybeSingle();
    if (t) {
      const [g, s] = await Promise.all([
        supabase.from("guardians").select("user_id, full_name").eq("id", t.guardian_id).maybeSingle(),
        supabase.from("staff").select("user_id, full_name").eq("id", t.teacher_staff_id).maybeSingle(),
      ]);
      if (g.data?.user_id) senderNames[g.data.user_id] = g.data.full_name;
      if (s.data?.user_id) senderNames[s.data.user_id] = s.data.full_name;
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={thread.subject}
        description={`${thread.guardianName ?? "Parent"} and ${thread.teacherName ?? "teacher"} · ${thread.studentName}`}
        back={{ href: `/${institutionSlug}/messages`, label: "Messages" }}
      />
      <Card className="gap-0 py-0">
        <CardContent className="py-4">
          <MessageList messages={messages} otherName={other} senderNames={senderNames} />
        </CardContent>
        <div className="border-t border-border bg-secondary/50 px-4 py-3">
          {canReply ? (
            <ReplyComposer institutionSlug={institutionSlug} threadId={threadId} markRead />
          ) : (
            <p className="text-sm text-muted-foreground">You are not part of this conversation, so it is read-only.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
