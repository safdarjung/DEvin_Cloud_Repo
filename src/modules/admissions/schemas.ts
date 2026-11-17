// T-027 — admissions module schemas (06 §W4, 07 §2.2 admissions.*). Stage
// codes are free strings (settings.admissions.stages, same shape as
// attendance's status codes — see src/modules/attendance/schemas.ts):
// actions.ts validates them dynamically against ctx.institution.settings,
// and the 20261028000016 DB triggers enforce the transition again
// regardless. `.strict()` on every object per CLAUDE.md rule 4.
import { z } from "zod";
import { isoDate, longText, phoneIN, shortText, uuid } from "@/lib/schemas/common";

const stageCode = z.string().trim().min(1).max(40);

export const UpdateEnquiryStatusSchema = z
  .object({
    enquiryId: uuid,
    status: stageCode,
    note: longText.optional(),
  })
  .strict();

export type UpdateEnquiryStatusInput = z.infer<typeof UpdateEnquiryStatusSchema>;

export const AddEnquiryNoteSchema = z
  .object({
    enquiryId: uuid,
    text: longText,
  })
  .strict();

export type AddEnquiryNoteInput = z.infer<typeof AddEnquiryNoteSchema>;

export const AssignEnquirySchema = z
  .object({
    enquiryId: uuid,
    staffId: uuid,
  })
  .strict();

export type AssignEnquiryInput = z.infer<typeof AssignEnquirySchema>;

// 05 §2.4 guardian_students.relationship check constraint — reused here so
// a converted application's guardian shape matches what enrolApplicant
// (T-028) will later write into guardian_students.
const relationship = z.enum(["father", "mother", "legal_guardian", "grandparent", "other"]);

export const ApplicantSchema = z
  .object({
    firstName: shortText,
    lastName: shortText.optional(),
    dob: isoDate,
    gender: shortText,
    previousSchool: shortText.optional(),
  })
  .strict();

export const ConvertGuardianSchema = z
  .object({
    fullName: shortText,
    phone: phoneIN,
    email: z.string().trim().email().optional(),
    relationship,
  })
  .strict();

export const ConvertEnquirySchema = z
  .object({
    enquiryId: uuid,
    applicant: ApplicantSchema,
    guardian: ConvertGuardianSchema,
    gradeId: uuid,
    academicYearId: uuid,
  })
  .strict();

export type ConvertEnquiryInput = z.infer<typeof ConvertEnquirySchema>;

export const DecideApplicationSchema = z
  .object({
    applicationId: uuid,
    decision: z.enum(["offer", "reject", "accept", "withdraw"]),
    note: longText.optional(),
  })
  .strict();

export type DecideApplicationInput = z.infer<typeof DecideApplicationSchema>;

export const StartApplicationReviewSchema = z.object({ applicationId: uuid }).strict();

export type StartApplicationReviewInput = z.infer<typeof StartApplicationReviewSchema>;

// T-028 — 06 §W4 enrolApplicant. roll_no is optional (app.enrol_applicant
// assigns max+1 for the section when omitted).
export const EnrolApplicantSchema = z
  .object({
    applicationId: uuid,
    classSectionId: uuid,
    feeStructureId: uuid,
    rollNo: z.number().int().positive().optional(),
  })
  .strict();

export type EnrolApplicantInput = z.infer<typeof EnrolApplicantSchema>;
