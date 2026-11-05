// Library module schemas with relative imports (seed-script safe).
import { z } from "zod";
import { uuid } from "../../lib/schemas/common.ts";

export const LIBRARY_SETTING_DEFAULTS = {
  loan_days: 14,
  fine_per_day: 1,
  max_loans_student: 2,
  max_loans_staff: 5,
} as const;

export type LibrarySettings = {
  loan_days: number;
  fine_per_day: number;
  max_loans_student: number;
  max_loans_staff: number;
};

// Parse settings.library block, apply defaults per key, never throw.
export function librarySettings(settings: Record<string, unknown>): LibrarySettings {
  if (!settings || typeof settings.library !== "object" || settings.library === null) {
    return LIBRARY_SETTING_DEFAULTS;
  }
  const lib = settings.library as Record<string, unknown>;
  return {
    loan_days: typeof lib.loan_days === "number" ? lib.loan_days : LIBRARY_SETTING_DEFAULTS.loan_days,
    fine_per_day: typeof lib.fine_per_day === "number" ? lib.fine_per_day : LIBRARY_SETTING_DEFAULTS.fine_per_day,
    max_loans_student: typeof lib.max_loans_student === "number" ? lib.max_loans_student : LIBRARY_SETTING_DEFAULTS.max_loans_student,
    max_loans_staff: typeof lib.max_loans_staff === "number" ? lib.max_loans_staff : LIBRARY_SETTING_DEFAULTS.max_loans_staff,
  };
}

const accession = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toUpperCase() : v),
  z.string().min(1).max(30).regex(/^[A-Z0-9/-]+$/)
);

export const BookUpsertSchema = z
  .object({
    id: uuid.optional(),
    title: z.string().trim().min(1).max(200),
    author: z.string().trim().min(1).max(120),
    isbn: z.preprocess(
      (v) => (typeof v === "string" ? v.replace(/[-\s]/g, "").toUpperCase() : v),
      z.string().regex(/^([0-9]{9}[0-9X]|[0-9]{13})$/, "Invalid ISBN format")
    )
      .optional()
      .nullable(),
  })
  .strict();

export type BookUpsertInput = z.infer<typeof BookUpsertSchema>;

export const CopiesAddSchema = z
  .object({
    bookId: uuid,
    accessionNos: z.array(accession).min(1).max(50),
  })
  .strict()
  .refine(
    (data) => new Set(data.accessionNos).size === data.accessionNos.length,
    {
      message: "Accession numbers must be unique",
      path: ["accessionNos"],
    }
  );

export type CopiesAddInput = z.infer<typeof CopiesAddSchema>;

export const CopySetStatusSchema = z
  .object({
    copyId: uuid,
    status: z.enum(["active", "withdrawn"]),
  })
  .strict();

export type CopySetStatusInput = z.infer<typeof CopySetStatusSchema>;

export const LoanIssueSchema = z
  .object({
    accessionNo: accession,
    studentId: uuid.optional(),
    staffId: uuid.optional(),
  })
  .strict()
  .refine(
    (data) => (data.studentId ? !data.staffId : false) || (data.staffId ? !data.studentId : false),
    {
      message: "Exactly one of studentId or staffId must be provided",
      path: ["studentId"],
    }
  );

export type LoanIssueInput = z.infer<typeof LoanIssueSchema>;

export const LoanRenewSchema = z
  .object({
    accessionNo: accession,
  })
  .strict();

export type LoanRenewInput = z.infer<typeof LoanRenewSchema>;

export const LoanReturnSchema = z
  .object({
    accessionNo: accession,
    waiveFine: z.boolean().default(false),
  })
  .strict();

export type LoanReturnInput = z.infer<typeof LoanReturnSchema>;

export const CatalogQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(60).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export type CatalogQueryInput = z.infer<typeof CatalogQuerySchema>;

export const OverdueQuerySchema = z
  .object({
    limit: z.number().int().min(1).max(500).optional(),
  })
  .strict();

export type OverdueQueryInput = z.infer<typeof OverdueQuerySchema>;

export const MyLoansQuerySchema = z
  .object({
    studentId: uuid.optional(),
  })
  .strict();

export type MyLoansQueryInput = z.infer<typeof MyLoansQuerySchema>;
