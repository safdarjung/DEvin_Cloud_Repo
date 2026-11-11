"use server";

// 0141 — timetable control writes: apply edits/suggestions, undo one change,
// change the rules, named snapshots. Every write lands in timetable_changes
// with who/when/before->after/why through the 0141 definers; all require
// timetable.manage (owner/principal/admin — the roles that publish).
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import type { Json } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";
import { applyCellChanges } from "./apply";
import { changesToReach, rollbackChange, type CellContent, type CellSlot } from "./checks";
import { versionCells, type LoggedCell } from "./control.queries";
import {
  ApplyChangesSchema,
  RollbackChangeSchema,
  SetRulesSchema,
  SnapshotCreateSchema,
  SnapshotRestoreSchema,
  type ApplyChangesInput,
  type RollbackChangeInput,
  type SetRulesInput,
  type SnapshotCreateInput,
  type SnapshotRestoreInput,
} from "./schemas";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

export const applyTimetableChanges = defineAction({
  name: "timetable.change.apply",
  module: "timetable",
  schema: ApplyChangesSchema,
  permission: "timetable.manage",
  handler: async ({ versionId, kind, changes, note }: ApplyChangesInput) => {
    const applied = await applyCellChanges(
      versionId,
      kind,
      changes.map((c) => ({
        ...c,
        after: c.after ? { ...c.after, roomId: c.after.roomId ?? null } : null,
        // A suggestion fills an empty period: refuse it if the period was filled since.
        ...(kind === "suggestion" ? { expect: null } : {}),
      })),
      note,
    );
    return { applied: applied.length, changes: applied };
  },
});

const asContent = (x: LoggedCell | null): CellContent | null =>
  x?.subjectId && x.teacherId ? { subjectId: x.subjectId, teacherId: x.teacherId, roomId: x.roomId ?? null } : null;

export const rollbackTimetableChange = defineAction({
  name: "timetable.change.rollback",
  module: "timetable",
  schema: RollbackChangeSchema,
  permission: "timetable.manage",
  handler: async ({ changeId, note }: RollbackChangeInput, ctx) => {
    const supabase = await createClient();
    const { data: change, error } = await supabase
      .from("timetable_changes")
      .select("id, version_id, action, class_section_id, weekday, period_id, substitution_id, label, before, after, reason, kind")
      .eq("institution_id", ctx.institution.id)
      .eq("id", changeId)
      .maybeSingle();
    if (error) throwMapped(error);
    if (!change) throw new AppError("not_found", "Change not found.");

    if (change.substitution_id) {
      const { error: undoError } = await supabase.rpc("undo_substitution", { p_change_id: changeId, p_note: note || undefined });
      if (undoError) throwMapped(undoError);
      return { undone: changeId, kind: "substitution" as const };
    }

    if (change.action === "rules") {
      const { error: rulesError } = await supabase.rpc("set_timetable_rules", {
        p_institution_id: ctx.institution.id,
        p_rules: (change.before as Json) ?? {},
        p_reason: `Rollback of: ${change.reason}${note ? ` Note: ${note}` : ""}`.slice(0, 500),
        p_reverts_change_id: changeId,
      });
      if (rulesError) throwMapped(rulesError);
      return { undone: changeId, kind: "rules" as const };
    }

    if (!change.class_section_id || !change.version_id || change.weekday === null || !change.period_id) {
      throw new AppError("invalid_state", "Publishing can't be undone here. Use Compare and restore to bring back an earlier version.");
    }

    const compensation = rollbackChange(
      {
        classSectionId: change.class_section_id,
        weekday: change.weekday,
        periodId: change.period_id,
        kind: change.kind,
        label: change.label,
        reason: change.reason,
        before: asContent(change.before as LoggedCell | null),
        after: asContent(change.after as LoggedCell | null),
      },
      note,
    );
    try {
      await applyCellChanges(change.version_id, "rollback", [compensation], note, changeId);
    } catch (e) {
      if (e instanceof AppError && e.code === "conflict") {
        const where = change.label ?? "This period";
        const message = /no longer holds/.test(e.message)
          ? `Can't undo: ${where} was changed again after this change. Undo the later change first.`
          : /already been undone/.test(e.message)
            ? "That change has already been undone."
            : `Can't undo: it would cause a clash — ${e.message.replace(/^\w+ double-booked at change \d+: /, "")}.`;
        throw new AppError("conflict", message);
      }
      throw e;
    }
    return { undone: changeId, kind: "cell" as const };
  },
});

export const setTimetableRules = defineAction({
  name: "timetable.rules.set",
  module: "timetable",
  schema: SetRulesSchema,
  permission: "timetable.manage",
  handler: async ({ rules, reason }: SetRulesInput, ctx) => {
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_timetable_rules", {
      p_institution_id: ctx.institution.id,
      p_rules: rules as unknown as Json,
      p_reason: reason,
    });
    if (error) throwMapped(error);
    return { rules };
  },
});

// Compact on purpose: a 1,300-period timetable stays well under the 0141 size checks.
type SnapshotSlot = { s: string; w: number; p: string; sub: string; t: string; r: string | null };

export const createTimetableSnapshot = defineAction({
  name: "timetable.snapshot.create",
  module: "timetable",
  schema: SnapshotCreateSchema,
  permission: "timetable.manage",
  handler: async ({ versionId, name }: SnapshotCreateInput, ctx) => {
    const cells = await versionCells(ctx, versionId);
    const slots: SnapshotSlot[] = cells.map((c) => ({ s: c.classSectionId, w: c.weekday, p: c.periodId, sub: c.subjectId, t: c.teacherId, r: c.roomId }));
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("timetable_snapshots")
      .insert({ institution_id: ctx.institution.id, version_id: versionId, name, slots: slots as unknown as NonNullable<Json>, created_by: ctx.user.id })
      .select("id")
      .single();
    if (error) throwMapped(error);
    await audit(ctx, { action: "timetable.snapshot.create", entityType: "timetable_snapshot", entityId: data.id, after: { slotCount: slots.length } });
    return { id: data.id as string, slotCount: slots.length };
  },
});

export const restoreTimetableSnapshot = defineAction({
  name: "timetable.snapshot.restore",
  module: "timetable",
  schema: SnapshotRestoreSchema,
  permission: "timetable.manage",
  handler: async ({ snapshotId, note }: SnapshotRestoreInput, ctx) => {
    const supabase = await createClient();
    const { data: snap, error } = await supabase
      .from("timetable_snapshots")
      .select("id, version_id, name, slots")
      .eq("institution_id", ctx.institution.id)
      .eq("id", snapshotId)
      .maybeSingle();
    if (error) throwMapped(error);
    if (!snap) throw new AppError("not_found", "Snapshot not found.");

    const target: CellSlot[] = ((snap.slots as SnapshotSlot[]) ?? []).map((x) => ({
      classSectionId: x.s,
      weekday: x.w,
      periodId: x.p,
      subjectId: x.sub,
      teacherId: x.t,
      roomId: x.r ?? null,
    }));
    const current = await versionCells(ctx, snap.version_id);
    const changes = changesToReach(current, target, `Restored snapshot "${snap.name}"`);
    // Clears first, so a teacher or room freed by one change is free for the next.
    changes.sort((a, b) => Number(a.after !== null) - Number(b.after !== null));
    const applied = await applyCellChanges(snap.version_id, "restore", changes, note);
    return { applied: applied.length };
  },
});
