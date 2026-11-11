import { createHash } from "node:crypto";
import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";
import { demoUsers, insertOnce, isoAt } from "../lib/util.ts";

// enrolment_status_history is written by a trigger only when an enrolment's status changes, and
// every demo enrolment is still `active`; moving students to withdrawn/transferred would change
// rosters the rest of the demo depends on. So this seeds only the one consistent entry the
// trigger never records: the initial placement (from_status null -> active) for 20 students.
// invitations: the demo logins' own accepted invitations, plus pending, revoked and expired ones.

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const ACCEPTED = [
  ["principal", "principal"], ["admin", "admin"], ["accountant", "accountant"], ["admissions", "admissions"],
  ["examcontroller", "exam_controller"], ["teacher.vi-a", "teacher"], ["teacher.viii-b", "teacher"], ["teacher.x-a", "teacher"],
  ["guardian.one", "guardian"], ["guardian.two", "guardian"], ["student.one", "student"],
] as const;

export async function run(ctx: SeedContext): Promise<void> {
  const inst = ctx.institutionId;
  const users = await demoUsers(ctx.sql, inst);
  const admin = users["admin"]!;

  const enrolments = await ctx.sql<{ id: string; grade: string }[]>`
    select e.id, g.code as grade from public.enrolments e
    join public.class_sections cs on cs.id = e.class_section_id join public.grades g on g.id = cs.grade_id
    where e.institution_id = ${inst} and e.status = 'active' and cs.name = 'A' and g.code in ('VI', 'VIII', 'X')
    order by e.id limit 20`;
  await insertOnce(
    ctx.admin,
    "enrolment_status_history",
    enrolments.map((e, i) => ({
      id: uuidV5("people-history", `enrolment:${e.id}`),
      institution_id: inst,
      enrolment_id: e.id,
      from_status: null,
      to_status: "active",
      reason: i % 4 === 0 ? `New admission to Grade ${e.grade}` : `Promoted to Grade ${e.grade} for 2026-27`,
      changed_by: admin,
      created_at: isoAt(-225 + (i % 5), 5, i),
    })),
  );

  const links = await ctx.sql<{ key: string; link: string | null }[]>`
    select split_part(u.email, '@', 1) as key, coalesce(m.staff_id, m.guardian_id, m.student_id) as link
    from public.memberships m join auth.users u on u.id = m.user_id
    where m.institution_id = ${inst} and u.email like '%@demo.coolskool.test'`;
  const linkOf = new Map(links.map((l) => [l.key, l.link]));
  const spare = await ctx.sql<{ id: string; full_name: string; email: string | null }[]>`
    select s.id, s.full_name, s.email from public.staff s
    where s.institution_id = ${inst} and s.is_teaching and not exists (select 1 from public.memberships m where m.staff_id = s.id)
    order by s.id limit 4`;
  const spareGuardians = await ctx.sql<{ id: string; full_name: string }[]>`
    select g.id, g.full_name from public.guardians g
    where g.institution_id = ${inst} and not exists (select 1 from public.memberships m where m.guardian_id = g.id)
    order by g.id limit 4`;

  const invitation = (key: string, email: string, role: string, link: Partial<Record<"staff_id" | "guardian_id" | "student_id", string | null>>, day: number, state: "accepted" | "pending" | "revoked" | "expired", acceptedBy?: string) => ({
    id: uuidV5("people-history", `invitation:${key}`),
    institution_id: inst,
    email: email.toLowerCase(),
    role,
    staff_id: link.staff_id ?? null,
    guardian_id: link.guardian_id ?? null,
    student_id: link.student_id ?? null,
    token_hash: sha256(`seed-invitation-token:${key}`),
    invited_by: admin,
    expires_at: isoAt(state === "expired" ? day + 7 : state === "pending" ? 5 : day + 14, 12),
    accepted_at: state === "accepted" ? isoAt(day + 1, 9) : null,
    accepted_by: state === "accepted" ? acceptedBy! : null,
    revoked_at: state === "revoked" ? isoAt(day + 2, 10) : null,
    created_at: isoAt(day, 8),
  });

  const rows = [
    ...ACCEPTED.map(([key, role], i) => invitation(key, `${key}@demo.coolskool.test`, role,
      role === "guardian" ? { guardian_id: linkOf.get(key) } : role === "student" ? { student_id: linkOf.get(key) } : { staff_id: linkOf.get(key) }, -200 + i, "accepted", users[key]!)),
    ...spare.slice(0, 2).map((s, i) => invitation(`pending-staff-${i}`, `${s.full_name.toLowerCase().replace(/[^a-z]+/g, ".")}@school-staff.example.com`, "teacher", { staff_id: s.id }, -2 - i, "pending")),
    ...spareGuardians.slice(0, 2).map((g, i) => invitation(`pending-guardian-${i}`, `${g.full_name.toLowerCase().replace(/[^a-z]+/g, ".")}@parents.example.com`, "guardian", { guardian_id: g.id }, -1 - i, "pending")),
    ...spare.slice(2, 3).map((s) => invitation("revoked-staff", `${s.full_name.toLowerCase().replace(/[^a-z]+/g, ".")}@school-staff.example.com`, "teacher", { staff_id: s.id }, -30, "revoked")),
    ...spareGuardians.slice(2, 3).map((g) => invitation("revoked-guardian", `${g.full_name.toLowerCase().replace(/[^a-z]+/g, ".")}@parents.example.com`, "guardian", { guardian_id: g.id }, -26, "revoked")),
    ...spare.slice(3, 4).map((s) => invitation("expired-staff", `${s.full_name.toLowerCase().replace(/[^a-z]+/g, ".")}@school-staff.example.com`, "teacher", { staff_id: s.id }, -45, "expired")),
    ...spareGuardians.slice(3, 4).map((g) => invitation("expired-guardian", `${g.full_name.toLowerCase().replace(/[^a-z]+/g, ".")}@parents.example.com`, "guardian", { guardian_id: g.id }, -40, "expired")),
  ];
  await insertOnce(ctx.admin, "invitations", rows);
}
