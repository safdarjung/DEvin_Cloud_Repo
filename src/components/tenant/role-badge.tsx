import { Badge } from "@/components/ui/badge";
import type { Role } from "@/lib/auth/permissions";

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  principal: "Principal",
  admin: "Admin",
  admissions: "Admissions",
  accountant: "Accountant",
  exam_controller: "Exam Controller",
  teacher: "Teacher",
  student: "Student",
  guardian: "Guardian",
};

export function RoleBadge({ role }: { role: Role }) {
  return <Badge variant="outline">{ROLE_LABELS[role]}</Badge>;
}
