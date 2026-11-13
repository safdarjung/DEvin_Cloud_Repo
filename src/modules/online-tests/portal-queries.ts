import "server-only";
// Guardian view of a child's online test results. Attempts come through RLS
// (0150 lets a guardian read a linked child's attempts); each result then goes
// through get_test_result, which refuses anything not yet released, so an
// unreleased test never shows up here.
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { testResult, type TestResult } from "@/modules/online-tests/queries";

export async function releasedResultsForStudent(ctx: TenantContext, studentId: string): Promise<TestResult[]> {
  const db = await createClient();
  const { data, error } = await db
    .from("test_attempts")
    .select("id, status")
    .eq("institution_id", ctx.institution.id)
    .eq("student_id", studentId)
    .neq("status", "in_progress")
    .order("submitted_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  const settled = await Promise.allSettled(data.map((a) => testResult(ctx, a.id)));
  return settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
}
