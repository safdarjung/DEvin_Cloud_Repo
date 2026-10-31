// M04-T4 — CSV parse + per-row validation for bulk student/staff import.
// Validates CSV shape only: grade/section/department are resolved to ids by
// the stage action (T5), which also enforces duplicate admission_no/employee_no
// within a file.
// Relative + .ts import: mirrors src/modules/core/schemas.ts (seed-script safe).
import Papa from "papaparse";
import { z } from "zod";
import { isoDate, uuid } from "../../lib/schemas/common.ts";
import { AppError } from "../../lib/actions/result.ts";

const MAX_ROWS = 5000;
const MAX_CSV_BYTES = 1_048_576; // 1 MB

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  if (text.trim() === "") {
    throw new AppError("validation_failed", "CSV file is empty.");
  }

  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
    transform: (value) => value.trim(),
  });

  if (result.errors.length > 0) {
    throw new AppError("validation_failed", result.errors[0].message);
  }

  if (result.data.length > MAX_ROWS) {
    throw new AppError("validation_failed", `CSV has more than ${MAX_ROWS} rows.`);
  }

  return { headers: result.meta.fields ?? [], rows: result.data };
}

export const STUDENT_COLUMNS = [
  "admission_no",
  "first_name",
  "last_name",
  "dob",
  "gender",
  "grade",
  "section",
  "roll_no",
  "guardian_name",
  "guardian_phone",
  "guardian_email",
  "guardian_relationship",
] as const;

export const STAFF_COLUMNS = [
  "employee_no",
  "full_name",
  "designation",
  "department",
  "phone",
  "email",
  "is_teaching",
] as const;

const PHONE_RE = /^[6-9]\d{9}$/;

function normalizePhone(value: string): string {
  return value.replace(/[\s-]/g, "").replace(/^\+91/, "");
}

function emptyToUndefined(value: string): string | undefined {
  return value.trim() === "" ? undefined : value.trim();
}

const requiredPhone = z
  .string()
  .trim()
  .transform(normalizePhone)
  .pipe(z.string().regex(PHONE_RE, "Invalid phone number."));

const optionalPhone = z
  .string()
  .transform((value) => (value.trim() === "" ? undefined : normalizePhone(value)))
  .pipe(z.string().regex(PHONE_RE, "Invalid phone number.").optional());

function optionalTrimmed(max: number) {
  return z
    .string()
    .transform(emptyToUndefined)
    .pipe(z.string().min(1).max(max).optional());
}

const optionalEmail = z
  .string()
  .transform(emptyToUndefined)
  .pipe(z.string().trim().email().optional());

const optionalRollNo = z
  .string()
  .transform(emptyToUndefined)
  .pipe(
    z
      .string()
      .regex(/^\d+$/, "Must be a whole number.")
      .transform(Number)
      .pipe(z.number().int().min(1).max(999))
      .optional(),
  );

const isTeachingSchema = z
  .string()
  .trim()
  .transform((value) => value.toLowerCase())
  .pipe(z.enum(["yes", "no"]))
  .transform((value) => value === "yes");

export const StudentImportRowSchema = z
  .object({
    admission_no: z.string().trim().min(1).max(40),
    first_name: z.string().trim().min(1).max(80),
    last_name: optionalTrimmed(80),
    dob: isoDate,
    gender: z.enum(["male", "female", "other"]),
    grade: z.string().trim().min(1).max(20),
    section: z.string().trim().min(1).max(20),
    roll_no: optionalRollNo,
    guardian_name: z.string().trim().min(1).max(120),
    guardian_phone: requiredPhone,
    guardian_email: optionalEmail,
    guardian_relationship: z.enum(["father", "mother", "legal_guardian", "grandparent", "other"]),
  })
  .strict();
export type StudentImportRowInput = z.infer<typeof StudentImportRowSchema>;

export const StaffImportRowSchema = z
  .object({
    employee_no: z.string().trim().min(1).max(40),
    full_name: z.string().trim().min(1).max(120),
    designation: z.string().trim().min(1).max(80),
    department: optionalTrimmed(80),
    phone: optionalPhone,
    email: optionalEmail,
    is_teaching: isTeachingSchema,
  })
  .strict();
export type StaffImportRowInput = z.infer<typeof StaffImportRowSchema>;

export const StageImportSchema = z
  .object({
    entityType: z.enum(["students", "staff"]),
    fileName: z.string().trim().min(1).max(200),
    csv: z.string().max(MAX_CSV_BYTES),
  })
  .strict();
export type StageImportInput = z.infer<typeof StageImportSchema>;

export const CommitImportSchema = z
  .object({
    batchId: uuid,
  })
  .strict();
export type CommitImportInput = z.infer<typeof CommitImportSchema>;
