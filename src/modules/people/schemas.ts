// M03-T10 — department/staff setup schemas (05 §2, 07 §2.2 staff.write).
// Columns exactly as 0004: departments.name; staff.{employee_no, full_name,
// designation, department_id, phone, email, status, is_teaching}.
import { z } from "zod";
import { notFutureDate, phoneIN, shortText, uuid } from "@/lib/schemas/common";
import { QUAL_LEVELS } from "./qualifications";

export const DepartmentUpsertSchema = z
  .object({
    id: uuid.optional(),
    name: shortText,
  })
  .strict();
export type DepartmentUpsertInput = z.infer<typeof DepartmentUpsertSchema>;

export const StaffUpsertSchema = z
  .object({
    id: uuid.optional(),
    employeeNo: shortText,
    fullName: shortText,
    designation: shortText,
    departmentId: uuid.optional(),
    phone: phoneIN.optional(),
    email: z.string().trim().email().max(200).optional(),
    isTeaching: z.boolean().optional(),
    status: z.enum(["active", "inactive"]).optional(),
  })
  .strict();
export type StaffUpsertInput = z.infer<typeof StaffUpsertSchema>;

// M14-T1 — student lifecycle people schemas.
export const StudentUpdateSchema = z
  .object({
    studentId: uuid,
    firstName: shortText.optional(),
    lastName: shortText.nullable().optional(),
    dob: notFutureDate.optional(),
    gender: z.enum(["male", "female", "other"]).optional(),
    admissionNo: z.string().trim().min(1).max(40).optional(),
  })
  .strict()
  .refine(
    (data) => {
      const hasOtherField = [
        data.firstName,
        data.lastName,
        data.dob,
        data.gender,
        data.admissionNo,
      ].some((v) => v !== undefined);
      return hasOtherField;
    },
    "Must update at least one field besides studentId"
  );

export type StudentUpdateInput = z.infer<typeof StudentUpdateSchema>;

/** Search-as-you-type student picker: 2+ characters, active students only. */
export const StudentSearchSchema = z.object({ q: z.string().trim().min(2).max(80) }).strict();
export type StudentSearchInput = z.infer<typeof StudentSearchSchema>;

export const GuardianUpdateSchema = z
  .object({
    guardianId: uuid,
    fullName: shortText.optional(),
    phone: phoneIN.optional(),
    email: z.string().trim().email().max(200).nullable().optional(),
  })
  .strict()
  .refine(
    (data) => {
      const hasOtherField = [data.fullName, data.phone, data.email].some(
        (v) => v !== undefined
      );
      return hasOtherField;
    },
    "Must update at least one field besides guardianId"
  );

export type GuardianUpdateInput = z.infer<typeof GuardianUpdateSchema>;

export const GuardianLinkSchema = z
  .object({
    studentId: uuid,
    relationship: z.enum([
      "father",
      "mother",
      "legal_guardian",
      "grandparent",
      "other",
    ]),
    isPrimary: z.boolean().optional(),
    guardianId: uuid.optional(),
    guardian: z
      .object({
        fullName: shortText,
        phone: phoneIN,
        email: z.string().trim().email().max(200).optional(),
      })
      .optional(),
  })
  .strict()
  .refine(
    (data) => {
      const hasGuardianId = data.guardianId !== undefined;
      const hasGuardian = data.guardian !== undefined;
      return hasGuardianId !== hasGuardian;
    },
    "Exactly one of guardianId or guardian must be provided"
  );

export type GuardianLinkInput = z.infer<typeof GuardianLinkSchema>;

// Students list filters (search params, so every field is optional and
// untrusted until parsed here).
export const StudentListFiltersSchema = z
  .object({
    gradeId: z.string().uuid().optional(),
    sectionId: z.string().uuid().optional(),
    status: z.enum(["active", "alumni", "withdrawn"]).optional(),
  })
  .strip();

export type StudentListFiltersInput = z.infer<typeof StudentListFiltersSchema>;

// 0155: a staff member's own teaching profile (first sign-in form).
export const QualificationSchema = z
  .object({
    level: z.enum(QUAL_LEVELS),
    degree: z.string().trim().min(1, "Name the degree, e.g. B.Ed.").max(80),
    subject: z.string().trim().max(80).optional(),
    year: z.number().int().min(1950).max(2100).optional(),
  })
  .strict();
export const SaveTeacherProfileSchema = z
  .object({
    qualifications: z.array(QualificationSchema).min(1, "Add at least one qualification.").max(10),
    subjectIds: z.array(uuid).max(40),
    gradeIds: z.array(uuid).max(20),
    experienceYears: z.number().int().min(0).max(60).nullable(),
  })
  .strict();
export type SaveTeacherProfileInput = z.infer<typeof SaveTeacherProfileSchema>;

// 0155: the highest class each qualification level may teach (grade codes), saved to settings.staff.
export const SaveQualificationRulesSchema = z
  .object({ maxGradeByLevel: z.partialRecord(z.enum(QUAL_LEVELS), z.string().trim().min(1).max(20)) })
  .strict();
export type SaveQualificationRulesInput = z.infer<typeof SaveQualificationRulesSchema>;
