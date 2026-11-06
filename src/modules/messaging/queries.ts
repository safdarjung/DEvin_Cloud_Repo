import "server-only";
// Parent-teacher messaging reads. Session client only: RLS (0102) is the row
// filter (participants + owner/principal/admin). Names that RLS hides from the
// other side come from the participant-checked definer reads.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import type { MyThreadsInput } from "@/modules/messaging/schemas";

const THREAD_LIMIT = 50;
const PREVIEW_CHARS = 120;

export interface ThreadSummary {
  id: string;
  studentId: string;
  studentName: string;
  subject: string;
  guardianName: string | null;
  teacherName: string | null;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  unreadCount: number;
}

export interface ThreadMessage {
  id: string;
  senderProfileId: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  mine: boolean;
}

export interface MessageableTeacher {
  staffId: string;
  fullName: string;
  isClassTeacher: boolean;
  subjectNames: string[];
}

export async function myThreads(ctx: TenantContext, { studentId }: MyThreadsInput = {}): Promise<ThreadSummary[]> {
  const supabase = await createClient();
  let query = supabase
    .from("message_threads")
    .select("id, student_id, subject, last_message_at, students(first_name, last_name), messages(body, sender_profile_id, read_at, created_at)")
    .eq("institution_id", ctx.institution.id)
    .order("last_message_at", { ascending: false })
    .order("created_at", { referencedTable: "messages", ascending: false })
    .limit(THREAD_LIMIT);
  if (studentId) query = query.eq("student_id", studentId);

  const { data, error } = await query;
  if (error) throw error;
  const rows = data ?? [];

  let names = new Map<string, { guardian_name: string; teacher_name: string }>();
  if (rows.length > 0) {
    const { data: nameRows, error: nameError } = await supabase.rpc("message_thread_names", {
      p_thread_ids: rows.map((r) => r.id),
    });
    if (nameError) throw nameError;
    names = new Map((nameRows ?? []).map((n) => [n.thread_id, n]));
  }

  return rows.map((row) => {
    const student = row.students as { first_name: string; last_name: string | null } | null;
    const messages = (row.messages ?? []) as { body: string; sender_profile_id: string; read_at: string | null }[];
    const name = names.get(row.id);
    return {
      id: row.id,
      studentId: row.student_id,
      studentName: [student?.first_name, student?.last_name].filter(Boolean).join(" "),
      subject: row.subject,
      guardianName: name?.guardian_name ?? null,
      teacherName: name?.teacher_name ?? null,
      lastMessageAt: row.last_message_at,
      lastMessagePreview: messages[0] ? messages[0].body.slice(0, PREVIEW_CHARS) : null,
      unreadCount: messages.filter((m) => m.sender_profile_id !== ctx.user.id && m.read_at === null).length,
    };
  });
}

export async function threadMessages(ctx: TenantContext, threadId: string): Promise<ThreadMessage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("messages")
    .select("id, sender_profile_id, body, read_at, created_at")
    .eq("institution_id", ctx.institution.id)
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw error;
  return (data ?? []).map((m) => ({
    id: m.id,
    senderProfileId: m.sender_profile_id,
    body: m.body,
    readAt: m.read_at,
    createdAt: m.created_at,
    mine: m.sender_profile_id === ctx.user.id,
  }));
}

/** Guardian only: the teachers of one of their own children (empty for anyone else). */
export async function messageableTeachers(ctx: TenantContext, studentId: string): Promise<MessageableTeacher[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("messageable_teachers", {
    p_institution_id: ctx.institution.id,
    p_student_id: studentId,
  });
  if (error) throw error;
  return (data ?? []).map((t) => ({
    staffId: t.staff_id,
    fullName: t.full_name,
    isClassTeacher: t.is_class_teacher,
    subjectNames: t.subject_names,
  }));
}
