"use server";

// Compliance actions (migration 0130). Renewal goes only through the definer renew_compliance_item
// (moves due_on + writes the append-only event); due_on is never updated directly.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import {
  ComplianceItemCreateSchema,
  ComplianceItemDeleteSchema,
  ComplianceItemUpdateSchema,
  ComplianceRenewSchema,
  ComplianceStarterLoadSchema,
} from "@/modules/compliance/schemas";
import { COMPLIANCE_STARTER } from "@/modules/compliance/templates";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

export const createComplianceItem = defineAction({
  name: "compliance.item.create",
  module: "compliance",
  schema: ComplianceItemCreateSchema,
  permission: "compliance.manage",
  handler: async (i, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("compliance_items")
      .insert({
        institution_id: ctx.institution.id,
        title: i.title,
        category: i.category,
        authority: clean(i.authority),
        reference_no: clean(i.referenceNo),
        due_on: i.dueOn,
        renew_every_months: i.renewEveryMonths ?? null,
        owner_staff_id: i.ownerStaffId ?? null,
        notes: clean(i.notes),
      })
      .select("id")
      .single();
    if (error) throwMapped(error);
    await audit(ctx, { action: "compliance.item.create", entityType: "compliance_items", entityId: data.id });
    return { id: data.id as string };
  },
});

export const updateComplianceItem = defineAction({
  name: "compliance.item.update",
  module: "compliance",
  schema: ComplianceItemUpdateSchema,
  permission: "compliance.manage",
  handler: async (i, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("compliance_items")
      .update({
        title: i.title,
        category: i.category,
        authority: clean(i.authority),
        reference_no: clean(i.referenceNo),
        renew_every_months: i.renewEveryMonths ?? null,
        owner_staff_id: i.ownerStaffId ?? null,
        notes: clean(i.notes),
      })
      .eq("id", i.id)
      .eq("institution_id", ctx.institution.id)
      .select("id")
      .maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Item not found.");
    await audit(ctx, { action: "compliance.item.update", entityType: "compliance_items", entityId: i.id });
    return { id: i.id };
  },
});

export const deleteComplianceItem = defineAction({
  name: "compliance.item.delete",
  module: "compliance",
  schema: ComplianceItemDeleteSchema,
  permission: "compliance.manage",
  handler: async ({ id }, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.from("compliance_items").delete().eq("id", id).eq("institution_id", ctx.institution.id).select("id").maybeSingle();
    // 23503: renewal history references the item (append-only events) — say so plainly.
    if ((error as { code?: string } | null)?.code === "23503") throw new AppError("conflict", "This item has renewal history and cannot be deleted.");
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Item not found.");
    await audit(ctx, { action: "compliance.item.delete", entityType: "compliance_items", entityId: id });
    return { id };
  },
});

export const renewComplianceItem = defineAction({
  name: "compliance.item.renew",
  module: "compliance",
  schema: ComplianceRenewSchema,
  permission: "compliance.manage",
  handler: async (i, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("renew_compliance_item", {
      p_institution_id: ctx.institution.id,
      p_item_id: i.itemId,
      // No defaults on the function: PostgREST needs every arg, so send explicit nulls.
      p_renewed_on: (i.renewedOn ?? null) as unknown as string,
      p_new_due_on: (i.newDueOn ?? null) as unknown as string,
      p_document_id: (i.documentId ?? null) as unknown as string,
      p_note: (i.note ?? null) as unknown as string,
    });
    if (error) throwMapped(error);
    if (!data) throw new AppError("internal", "Unexpected response shape.");
    return { id: i.itemId, dueOn: data.due_on };
  },
});

// Titles and categories come from the server template; the admin supplies each due date.
export const loadComplianceStarter = defineAction({
  name: "compliance.starter.load",
  module: "compliance",
  schema: ComplianceStarterLoadSchema,
  permission: "compliance.manage",
  handler: async ({ items }, ctx) => {
    const supabase = await createClient();
    const { data: existing, error: exErr } = await supabase.from("compliance_items").select("title").eq("institution_id", ctx.institution.id);
    if (exErr) throwMapped(exErr);
    const have = new Set((existing ?? []).map((r) => r.title.toLowerCase()));
    const rows = [];
    for (const it of items) {
      const tpl = COMPLIANCE_STARTER.find((t) => t.title === it.title);
      if (!tpl) throw new AppError("validation_failed", "Unknown starter item.");
      if (have.has(tpl.title.toLowerCase())) continue;
      have.add(tpl.title.toLowerCase());
      rows.push({ institution_id: ctx.institution.id, title: tpl.title, category: tpl.category, due_on: it.dueOn });
    }
    if (rows.length) {
      const { error } = await supabase.from("compliance_items").insert(rows);
      if (error) throwMapped(error);
    }
    await audit(ctx, { action: "compliance.starter.load", entityType: "compliance_items", metadata: { created: rows.length } });
    return { created: rows.length, skipped: items.length - rows.length };
  },
});
