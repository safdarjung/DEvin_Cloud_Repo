import "server-only";
// 0141 — the one TS path into public.apply_timetable_changes (every cell
// edit: manual, suggestion, saveDraft, snapshot restore, rollback). Maps the
// definer's coded errors to the envelope; the definer itself re-checks role,
// version state, tenant binding, clashes and the published-version note.
import { AppError, mapSqlError } from "@/lib/actions/result";
import type { Json } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";
import type { CellChange } from "./checks";

export type ApplyKind = "manual" | "suggestion" | "restore" | "rollback";

export interface AppliedChange {
  id: string;
  action: string;
  label: string | null;
  reason: string;
}

function toRpc(c: CellChange): Json {
  const content = (x: CellChange["after"]) => (x ? { subjectId: x.subjectId, teacherId: x.teacherId, roomId: x.roomId ?? null } : null);
  return {
    sectionId: c.classSectionId,
    weekday: c.weekday,
    periodId: c.periodId,
    after: content(c.after),
    ...(c.expect !== undefined ? { expect: content(c.expect) } : {}),
    ...(c.reason ? { reason: c.reason } : {}),
    ...(c.rules?.length ? { rules: c.rules } : {}),
  };
}

/** Index of the change a coded conflict names ("... at change 3: ..."), or null. */
export function conflictIndex(message: string): number | null {
  const m = /at change (\d+)/.exec(message);
  return m ? Number(m[1]) : null;
}

export async function applyCellChanges(
  versionId: string,
  kind: ApplyKind,
  changes: CellChange[],
  note?: string,
  revertsChangeId?: string,
): Promise<AppliedChange[]> {
  const supabase = await createClient();
  const out: AppliedChange[] = [];
  // The definer takes 500 periods a call; bigger batches (a whole-school
  // restore) go in order, each call atomic on its own.
  for (let from = 0; from < changes.length; from += CHUNK) {
    const { data, error } = await supabase.rpc("apply_timetable_changes", {
      p_version_id: versionId,
      p_kind: kind,
      p_changes: changes.slice(from, from + CHUNK).map(toRpc),
      p_note: note || undefined,
      p_reverts_change_id: revertsChangeId,
    });
    if (error) {
      const mapped = mapSqlError(error);
      if (mapped.ok) throw new AppError("internal", "Unexpected error.");
      const at = conflictIndex(mapped.error.message);
      const message = at === null ? mapped.error.message : mapped.error.message.replace(/at change \d+/, `at change ${at + from}`);
      throw new AppError(mapped.error.code, message, mapped.error.code === "validation_failed" && /note/.test(message) ? { note: [message] } : undefined);
    }
    out.push(...(data ?? []).map((r) => ({ id: r.id, action: r.action, label: r.label, reason: r.reason })));
  }
  return out;
}

const CHUNK = 500;
