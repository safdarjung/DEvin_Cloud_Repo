// M02-T5 — read-only wrappers for ./queries.ts, exposed at
// /api/v1/query/finance.<fn>. defineQuery adds Zod input validation + a
// permission gate; RLS stays the actual data filter. Handlers only adapt
// input -> the existing fn's positional args: no new logic, no new SQL.
// paymentModesFor/moneyToPaise/paiseToMoney are skipped — synchronous, no
// I/O, pure helpers.
import { defineQuery } from "@/lib/actions/define-query";
import { isoDate, uuid } from "@/lib/schemas/common";
import { z } from "zod";
import {
  getFeeStructure,
  getInvoice,
  getReceipt,
  listAcademicYears,
  listDefaulters,
  listFeeStructures,
  listGradeOptions,
  listInvoices,
  listInvoicesForStudent,
  listLedgerEntries,
  listReceiptsForStudent,
  listTermOptions,
  termCollectionSummary,
} from "./queries";

// permission: academics.read — academic years are structure, not finance
// data; every role holds it (07 §2.2).
export const listAcademicYearsQuery = defineQuery({
  name: "finance.listAcademicYears",
  module: "fees",
  schema: z.object({}).strict(),
  permission: "academics.read",
  handler: (_input, ctx) => listAcademicYears(ctx),
});

// permission: finance.read — finance/structures/page.tsx and
// finance/structures/[id]/page.tsx gate finance.structure.manage,
// finance/invoices/page.tsx gates finance.read; finance.structure.manage's
// holders (owner/principal/admin/accountant) are already a subset of
// finance.read's holders.
export const listGradeOptionsQuery = defineQuery({
  name: "finance.listGradeOptions",
  module: "fees",
  schema: z.object({}).strict(),
  permission: "finance.read",
  handler: (_input, ctx) => listGradeOptions(ctx),
});

// permission: finance.read — finance/invoices/page.tsx:23 (only called
// when canGenerate/finance.invoice.generate is true) and
// finance/defaulters/page.tsx:27 (finance.structure.manage); both actual
// caller sets are subsets of finance.read's holders.
export const listTermOptionsQuery = defineQuery({
  name: "finance.listTermOptions",
  module: "fees",
  schema: z.object({ academicYearId: uuid.optional() }).strict(),
  permission: "finance.read",
  handler: (input, ctx) => listTermOptions(ctx, input.academicYearId),
});

// permission: student.read — finance/structures pages gate
// finance.structure.manage, but admissions/applications/[id]/page.tsx:28
// gates admissions.enquiry.read; neither finance nor admissions key covers
// both actual caller sets, so student.read (every role) is used.
export const listFeeStructuresQuery = defineQuery({
  name: "finance.listFeeStructures",
  module: "fees",
  schema: z.object({ academicYearId: uuid.optional(), gradeId: uuid.optional() }).strict(),
  permission: "student.read",
  handler: (input, ctx) => listFeeStructures(ctx, { academicYearId: input.academicYearId, gradeId: input.gradeId }),
});

// permission: finance.structure.manage — finance/structures/[id]/page.tsx's only caller.
export const getFeeStructureQuery = defineQuery({
  name: "finance.getFeeStructure",
  module: "fees",
  schema: z.object({ id: uuid }).strict(),
  permission: "finance.structure.manage",
  handler: (input, ctx) => getFeeStructure(ctx, input.id),
});

// permission: finance.read — finance/invoices/page.tsx's only caller.
export const listInvoicesQuery = defineQuery({
  name: "finance.listInvoices",
  module: "fees",
  schema: z.object({ termId: uuid.optional(), status: z.string().trim().min(1).max(50).optional(), gradeId: uuid.optional() }).strict(),
  permission: "finance.read",
  handler: (input, ctx) => listInvoices(ctx, { termId: input.termId, status: input.status, gradeId: input.gradeId }),
});

// permission: finance.read — the domain key (D41). students/[studentId]/page.tsx
// renders invoices behind only student.read; RLS still filters there (DBT-43).
export const listInvoicesForStudentQuery = defineQuery({
  name: "finance.listInvoicesForStudent",
  module: "fees",
  schema: z.object({ studentId: uuid }).strict(),
  permission: "finance.read",
  handler: (input, ctx) => listInvoicesForStudent(ctx, input.studentId),
});

// permission: finance.read — finance/invoices/[id]/page.tsx's only caller.
export const getInvoiceQuery = defineQuery({
  name: "finance.getInvoice",
  module: "fees",
  schema: z.object({ id: uuid }).strict(),
  permission: "finance.read",
  handler: (input, ctx) => getInvoice(ctx, input.id),
});

// permission: finance.read — 3 call sites (finance/receipts/[id]/page.tsx,
// finance/receipts/[id]/print/page.tsx, portal/fees/receipts/[id]/page.tsx),
// all gate finance.read.
export const getReceiptQuery = defineQuery({
  name: "finance.getReceipt",
  module: "fees",
  schema: z.object({ id: uuid }).strict(),
  permission: "finance.read",
  handler: (input, ctx) => getReceipt(ctx, input.id),
});

// permission: finance.read — portal/fees/page.tsx's only caller.
export const listReceiptsForStudentQuery = defineQuery({
  name: "finance.listReceiptsForStudent",
  module: "fees",
  schema: z.object({ studentId: uuid }).strict(),
  permission: "finance.read",
  handler: (input, ctx) => listReceiptsForStudent(ctx, input.studentId),
});

// permission: finance.structure.manage — finance/ledger/page.tsx's only caller.
export const listLedgerEntriesQuery = defineQuery({
  name: "finance.listLedgerEntries",
  module: "fees",
  schema: z
    .object({
      from: isoDate,
      to: isoDate,
      account: z.string().trim().min(1).max(100).optional(),
      page: z.number().int().positive().optional(),
      pageSize: z.number().int().positive().optional(),
    })
    .strict(),
  permission: "finance.structure.manage",
  handler: (input, ctx) =>
    listLedgerEntries(ctx, { from: input.from, to: input.to, account: input.account }, input.page, input.pageSize),
});

// permission: finance.structure.manage — finance/defaulters/page.tsx:29
// (finance.structure.manage) and dashboard/page.tsx:153's
// (isLeader || accountant) condition (owner/principal/admin/accountant) —
// both actual caller sets equal finance.structure.manage's own holders.
export const listDefaultersQuery = defineQuery({
  name: "finance.listDefaulters",
  module: "fees",
  schema: z.object({ termId: uuid }).strict(),
  permission: "finance.structure.manage",
  handler: (input, ctx) => listDefaulters(ctx, { termId: input.termId }),
});

// permission: finance.read — module default; this fn's only caller
// (core's currentTermCollections, inside getDashboardData) is itself
// gated on finance.read before it ever calls this.
export const termCollectionSummaryQuery = defineQuery({
  name: "finance.termCollectionSummary",
  module: "fees",
  schema: z.object({ termId: uuid }).strict(),
  permission: "finance.read",
  handler: (input, ctx) => termCollectionSummary(ctx, input.termId),
});
