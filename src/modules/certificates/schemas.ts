// X02-T4 — Zod schemas for certificate.* actions and queries.
// Relative + .ts import: mirrors src/modules/timetable/schemas.ts (seed-script safe).
import { z } from "zod";
import { uuid } from "../../lib/schemas/common.ts";

export const CertificateKindSchema = z.enum(["bonafide", "character", "transfer"]);
export type CertificateKind = z.infer<typeof CertificateKindSchema>;

// Bonafide: must have purpose (trimmed 3–200). No conduct allowed.
const BonafideSchema = z
  .object({
    kind: z.literal("bonafide"),
    studentId: uuid,
    purpose: z.string().trim().min(3).max(200),
  })
  .strict();

// Character: must have conduct (trimmed 2–100). Purpose optional (3–200).
const CharacterSchema = z
  .object({
    kind: z.literal("character"),
    studentId: uuid,
    conduct: z.string().trim().min(2).max(100),
    purpose: z.string().trim().min(3).max(200).optional(),
  })
  .strict();

// Transfer: only studentId. No purpose or conduct.
const TransferSchema = z
  .object({
    kind: z.literal("transfer"),
    studentId: uuid,
  })
  .strict();

export const IssueCertificateSchema = z.discriminatedUnion("kind", [
  BonafideSchema,
  CharacterSchema,
  TransferSchema,
]);
export type IssueCertificateInput = z.infer<typeof IssueCertificateSchema>;

export const CertificateListSchema = z
  .object({
    studentId: uuid.optional(),
    serialNo: z.string().trim().min(1).max(60).optional(),
    kind: CertificateKindSchema.optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export type CertificateListInput = z.infer<typeof CertificateListSchema>;

export const CertificatePrintSchema = z
  .object({
    certificateId: uuid,
  })
  .strict();
export type CertificatePrintInput = z.infer<typeof CertificatePrintSchema>;

export const IdCardsSchema = z
  .object({
    classSectionId: uuid,
  })
  .strict();
export type IdCardsInput = z.infer<typeof IdCardsSchema>;

// TC snapshot = 0076 exit_student's tc_snapshot verbatim (pupil fields frozen at exit
// + exit fields). Loose: future keys pass through. dues_outstanding is numeric in SQL
// and may arrive as a string through jsonb.
export const TcSnapshotSchema = z.looseObject({
  tc_no: z.string(),
  student_name: z.string(),
  admission_no: z.string(),
  dob: z.string(),
  gender: z.string(),
  primary_guardian_name: z.string().nullable(),
  grade: z.string().nullable(),
  section: z.string().nullable(),
  academic_year: z.string().nullable(),
  admitted_on: z.string().nullable(),
  left_on: z.string(),
  kind: z.string(),
  reason: z.string(),
  destination_school: z.string().nullable(),
  conduct: z.string().nullable(),
  dues_outstanding: z.coerce.number(),
});
export type TcSnapshot = z.infer<typeof TcSnapshotSchema>;

// Snapshot built in SQL at issue time (rulings: Snapshot). Loose: unknown keys kept.
export const CertificateSnapshotSchema = z.looseObject({
  kind: CertificateKindSchema,
  serial_no: z.string(),
  issued_on: z.string(),
  issued_by_name: z.string(),
  school: z.object({
    name: z.string(),
    board: z.string().nullable(),
    address: z.string().nullable(),
  }),
  student: z.object({
    name: z.string(),
    admission_no: z.string(),
    dob: z.string(),
    gender: z.string(),
    status: z.string(),
  }),
  guardian: z
    .object({
      name: z.string(),
      relationship: z.string(),
    })
    .nullable(),
  enrolment: z
    .object({
      grade: z.string(),
      section: z.string(),
      academic_year: z.string(),
      roll_no: z.number().int().nullable(),
      status: z.string(),
    })
    .nullable(),
  admitted_on: z.string().nullable(),
  purpose: z.string().nullable(),
  conduct: z.string().nullable(),
  tc: TcSnapshotSchema.nullable(),
});
export type CertificateSnapshot = z.infer<typeof CertificateSnapshotSchema>;
