// Compliance — Zod schemas. Relative + .ts imports: seed-script safe.
import { z } from "zod";
import { isoDate, uuid } from "../../lib/schemas/common.ts";
import { COMPLIANCE_CATEGORIES } from "./templates.ts";

export const COMPLIANCE_STATUSES = ["overdue", "due_soon", "ok"] as const;

const optText = (max: number) => z.string().trim().max(max).nullish();
const itemFields = {
  title: z.string().trim().min(1).max(200),
  category: z.enum(COMPLIANCE_CATEGORIES),
  authority: optText(200),
  referenceNo: optText(100),
  renewEveryMonths: z.number().int().min(1).max(120).nullish(),
  ownerStaffId: uuid.nullish(),
  notes: optText(1000),
};

export const ComplianceEmptySchema = z.object({}).strict();
// due_on is set once here; afterwards it moves only through renewal.
export const ComplianceItemCreateSchema = z.object({ ...itemFields, dueOn: isoDate }).strict();
export const ComplianceItemUpdateSchema = z.object({ id: uuid, ...itemFields }).strict();
export const ComplianceItemDeleteSchema = z.object({ id: uuid }).strict();
export const ComplianceRenewSchema = z
  .object({
    itemId: uuid,
    renewedOn: isoDate.optional(),
    newDueOn: isoDate.optional(),
    documentId: uuid.optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((d) => !d.renewedOn || !d.newDueOn || d.newDueOn > d.renewedOn, {
    message: "New due date must be after the renewal date.",
    path: ["newDueOn"],
  });
export const ComplianceStarterLoadSchema = z
  .object({ items: z.array(z.object({ title: z.string().trim().min(1).max(200), dueOn: isoDate }).strict()).min(1).max(20) })
  .strict();
export const ComplianceListSchema = z
  .object({ category: z.enum(COMPLIANCE_CATEGORIES).optional(), status: z.enum(COMPLIANCE_STATUSES).optional() })
  .strict();

export type ComplianceItemCreateInput = z.infer<typeof ComplianceItemCreateSchema>;
export type ComplianceItemUpdateInput = z.infer<typeof ComplianceItemUpdateSchema>;
export type ComplianceRenewInput = z.infer<typeof ComplianceRenewSchema>;
export type ComplianceStarterLoadInput = z.infer<typeof ComplianceStarterLoadSchema>;
