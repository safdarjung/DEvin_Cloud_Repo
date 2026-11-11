import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";

// Features-18 #12 — demo helpdesk: 24 tickets from the demo guardian, student and a teacher,
// each with a first message; most have a manager reply. Deterministic (fixed uuidV5 ids,
// index-derived fields, service-role insert), no ctx.rng draws. due_at follows the 0121
// priority windows from a fixed created_at, so older open tickets show as overdue.

const SUBJECTS = [
  ["fees", "Fee receipt not showing the transport charge"],
  ["transport", "Bus 4 arrives late every morning"],
  ["academics", "Request a re-check of the maths unit test"],
  ["technical", "Cannot open the portal on my phone"],
  ["facilities", "Water cooler on the first floor is broken"],
  ["other", "Need a duplicate ID card"],
  ["fees", "Query about the second instalment due date"],
  ["academics", "Homework not visible for science"],
] as const;
const PRIORITIES = ["normal", "low", "high", "urgent"] as const;
const WINDOW_HOURS = { urgent: 4, high: 24, normal: 72, low: 168 } as const;
const STATUSES = ["open", "open", "in_progress", "resolved", "closed", "open"] as const;
const HOUR = 3_600_000;

export async function run(ctx: SeedContext): Promise<void> {
  const raisers = [ctx.userIdByLogin["guardian.one"]!, ctx.userIdByLogin["student.one"]!, ctx.userIdByLogin["teacher.vi-a"]!, ctx.userIdByLogin["guardian.two"]!];
  const managers = [ctx.userIdByLogin["admin"]!, ctx.userIdByLogin["principal"]!];
  const managerStaff = [uuidV5("people", "admin"), uuidV5("people", "principal")];
  const base = Date.parse("2026-10-20T04:30:00Z");

  const tickets: Record<string, unknown>[] = [];
  const messages: Record<string, unknown>[] = [];
  for (let i = 0; i < 24; i++) {
    const [category, subject] = SUBJECTS[i % SUBJECTS.length]!;
    const priority = PRIORITIES[(i * 3 + Math.floor(i / 5)) % PRIORITIES.length]!;
    const status = STATUSES[i % STATUSES.length]!;
    const created = base + i * 11 * HOUR;
    const done = status === "resolved" || status === "closed";
    const id = uuidV5("helpdesk", `ticket:${i}`);
    const raiser = raisers[i % raisers.length]!;
    tickets.push({
      id,
      institution_id: ctx.institutionId,
      raised_by: raiser,
      category,
      priority,
      subject,
      status,
      assignee_staff_id: status === "open" && i % 2 === 0 ? null : managerStaff[i % 2]!,
      due_at: new Date(created + WINDOW_HOURS[priority] * HOUR).toISOString(),
      resolved_at: done ? new Date(created + 20 * HOUR).toISOString() : null,
      created_at: new Date(created).toISOString(),
    });
    messages.push({
      id: uuidV5("helpdesk", `message:${i}:0`),
      institution_id: ctx.institutionId,
      ticket_id: id,
      author_id: raiser,
      body: `${subject}. Please look into this when you can.`,
      created_at: new Date(created).toISOString(),
    });
    if (status !== "open" || i % 3 === 0) {
      messages.push({
        id: uuidV5("helpdesk", `message:${i}:1`),
        institution_id: ctx.institutionId,
        ticket_id: id,
        author_id: managers[i % 2]!,
        body: done ? "This is sorted now. Reply here if it comes back." : "Thanks, we are looking into it and will update you here.",
        created_at: new Date(created + 3 * HOUR).toISOString(),
      });
    }
  }
  await insertBatch(ctx.admin, "helpdesk_tickets", tickets);
  await insertBatch(ctx.admin, "helpdesk_messages", messages);
}
