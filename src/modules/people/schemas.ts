// M03-T10 — department/staff setup schemas (05 §2, 07 §2.2 staff.write).
// Columns exactly as 0004: departments.name; staff.{employee_no, full_name,
// designation, department_id, phone, email, status, is_teaching}.
import { z } from "zod";
import { phoneIN, shortText, uuid } from "@/lib/schemas/common";

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
