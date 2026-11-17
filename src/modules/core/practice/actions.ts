"use server";

// Practice scenarios (scenarios.ts): make a small realistic set of records for one tab in the demo
// school. Every record goes through the owning module's own action, so validation, permission,
// module gate and audit are the same as a person typing it in. Demo school only.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, type ActionResult } from "@/lib/actions/result";
import type { TenantContext } from "@/lib/auth/types";
import { logIncident } from "@/modules/behaviour/actions";
import { recordPayment } from "@/modules/finance/actions";
import { listInvoicesPage, paymentModesFor } from "@/modules/finance/queries";
import { addHealthVisit } from "@/modules/health/actions";
import { raiseTicket } from "@/modules/helpdesk/actions";
import { listStudents, type StudentListRow } from "@/modules/people/queries";
import { checkInVisitor } from "@/modules/visitors/actions";
import { PRACTICE_SCENARIOS, type PracticeScenarioKey } from "./scenarios";
import { RunPracticeScenarioSchema, type RunPracticeScenarioInput } from "./schemas";

function unwrap<T>(res: ActionResult<T>): T {
  if (!res.ok) throw new AppError(res.error.code, res.error.message);
  return res.data;
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

/** YYYY-MM-DD in India time, `days` ago. */
function dayAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

const fullName = (s: StudentListRow) => [s.firstName, s.lastName].filter(Boolean).join(" ");

/** Distinct active students this member can see, in random order. */
async function someStudents(ctx: TenantContext, count: number): Promise<StudentListRow[]> {
  const { students } = await listStudents(ctx, undefined, 1 + Math.floor(Math.random() * 3), { status: "active" });
  const pool = students.length >= count ? students : (await listStudents(ctx, undefined, 1, { status: "active" })).students;
  if (pool.length < count) throw new AppError("invalid_state", "There are not enough students you can see to make this scenario.");
  return [...pool].sort(() => Math.random() - 0.5).slice(0, count);
}

const phone = () => `9${String(Math.floor(100_000_000 + Math.random() * 899_999_999))}`;

/** What was made, and a page that shows it when it is not the scenario's own tab. */
type Made = { message: string; href?: string };

async function run(key: PracticeScenarioKey, ctx: TenantContext): Promise<Made> {
  const slug = ctx.institution.slug;
  switch (key) {
    case "helpdesk.urgent": {
      const stop = pick(["Sector 12", "Civil Lines", "Gandhi Nagar", "Station Road"]);
      unwrap(
        await raiseTicket(slug, {
          category: "transport",
          priority: "urgent",
          subject: `Bus did not reach ${stop} stop this morning`,
          body: `Practice ticket. The school bus did not come to the ${stop} stop at 7:10. Three children are still waiting. Please call back.`,
        }),
      );
      return { message: "Raised one urgent transport ticket." };
    }
    case "helpdesk.mixed": {
      const tickets = [
        { category: "fees", priority: "normal", subject: "Second-term fee receipt not received", body: "Practice ticket. I paid the second-term fee at the counter last week but have no receipt yet." },
        { category: "facilities", priority: "high", subject: "Projector in room 204 not working", body: "Practice ticket. The projector in room 204 shows no picture. I have a presentation in period 3." },
        { category: "technical", priority: "low", subject: "Cannot log in to the parent portal", body: "Practice ticket. The portal says my password is wrong after the reset email." },
      ] as const;
      for (const t of tickets) unwrap(await raiseTicket(slug, t));
      return { message: "Raised 3 tickets: fees (normal), facilities (high), technical (low)." };
    }
    case "visitors.rush": {
      const people = [
        { fullName: pick(["Sunita Verma", "Rakesh Gupta", "Meena Iyer"]), purpose: "Parent meeting with class teacher", meetingWith: "Class teacher" },
        { fullName: pick(["Imran Khan", "Vikas Yadav", "Arjun Nair"]), purpose: "Stationery delivery", meetingWith: "Office" },
        { fullName: pick(["Dr. Kavita Rao", "Prof. Anil Joshi", "Ritu Malhotra"]), purpose: "Guest talk for class X", meetingWith: "Principal" },
      ];
      for (const p of people) unwrap(await checkInVisitor(slug, { ...p, phone: phone() }));
      return { message: "Checked in 3 visitors: a parent, a vendor and a guest speaker." };
    }
    case "behaviour.mixed": {
      const [a, b] = await someStudents(ctx, 2);
      unwrap(await logIncident(slug, { studentId: a!.id, category: "Helpfulness", severity: "low", points: 5, note: "Practice: helped a classmate catch up on missed work." }));
      unwrap(await logIncident(slug, { studentId: b!.id, category: "Late to class", severity: "low", points: -2, note: "Practice: arrived 15 minutes late after break." }));
      return { message: `Logged a merit for ${fullName(a!)} and a demerit for ${fullName(b!)}.` };
    }
    case "behaviour.repeat": {
      const [s] = await someStudents(ctx, 1);
      const days = [
        { category: "Homework not done", points: -2, severity: "low", note: "Practice: maths homework missing." },
        { category: "Disrupting class", points: -3, severity: "medium", note: "Practice: talking during the science test." },
        { category: "Uniform", points: -1, severity: "low", note: "Practice: no tie, third reminder." },
      ] as const;
      for (const [i, d] of days.entries()) unwrap(await logIncident(slug, { studentId: s!.id, ...d, occurredOn: dayAgo(i) }));
      return { message: `Logged 3 demerits this week for ${fullName(s!)}.` };
    }
    case "finance.part-payment": {
      const { rows } = await listInvoicesPage(ctx, { status: "issued", page: 1 + Math.floor(Math.random() * 3) });
      const invoice = rows.find((r) => r.total - r.paidTotal >= 2);
      if (!invoice) throw new AppError("invalid_state", "There is no unpaid invoice to pay against.");
      const modes = paymentModesFor(ctx.institution.settings);
      if (modes.length === 0) throw new AppError("invalid_state", "No payment modes are set up for this school.");
      const amount = Math.floor((invoice.total - invoice.paidTotal) / 2);
      unwrap(
        await recordPayment(slug, {
          invoiceId: invoice.id,
          amount,
          mode: modes.includes("upi") ? "upi" : modes[0]!,
          reference: "Practice payment",
          receivedAt: new Date(),
          idempotencyKey: crypto.randomUUID(),
        }),
      );
      return {
        message: `Recorded ₹${amount.toLocaleString("en-IN")} against ${invoice.invoiceNo} for ${invoice.studentName}; half is still due.`,
        href: `/${slug}/finance/invoices/${invoice.id}`,
      };
    }
    case "health.sent-home": {
      const [s] = await someStudents(ctx, 1);
      unwrap(await addHealthVisit(slug, { studentId: s!.id, complaint: "Fever 101°F and headache", treatment: "Paracetamol given, guardian called", outcome: "sent_home" }));
      return { message: `Recorded an infirmary visit for ${fullName(s!)}: sent home with fever.` };
    }
    case "health.minor": {
      const [a, b] = await someStudents(ctx, 2);
      unwrap(await addHealthVisit(slug, { studentId: a!.id, complaint: "Scraped knee in the playground", treatment: "Cleaned and bandaged", outcome: "returned_to_class" }));
      unwrap(await addHealthVisit(slug, { studentId: b!.id, complaint: "Mild headache", treatment: "Rested 20 minutes, water", outcome: "returned_to_class" }));
      return { message: `Recorded two minor visits, for ${fullName(a!)} and ${fullName(b!)}.` };
    }
  }
}

export const runPracticeScenario = defineAction({
  name: "core.practice.run",
  module: "core",
  schema: RunPracticeScenarioSchema,
  permission: (input: RunPracticeScenarioInput) => PRACTICE_SCENARIOS[input.scenario].permission,
  handler: async ({ scenario }: RunPracticeScenarioInput, ctx) => {
    // The demo school is reset; a real school's records (some never deletable) are not.
    if (!ctx.institution.is_demo) throw new AppError("invalid_state", "Practice data can only be made in the demo school.");
    return run(scenario, ctx);
  },
});
