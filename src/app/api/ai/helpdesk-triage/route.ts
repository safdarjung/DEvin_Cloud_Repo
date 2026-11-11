import "server-only";
// features-18 §C2 — helpdesk triage: ticket id -> suggested category +
// priority, up to 3 similar resolved/closed tickets (picked in code by
// category + subject-word overlap, never by the model), and a draft reply.
// Persists nothing: the manager applies category/priority by hand and sends
// the edited reply through `helpdesk.message.reply`. PII allow-list for the
// prompt: subject, category, priority, the raiser's ROLE, message bodies
// labelled by side — with names, phones and emails redacted before the
// prompt is built (on every provider, not only cloud).
import { ok, fail } from "@/lib/actions/result";
import { runStructured } from "@/lib/ai/gateway";
import { redact } from "@/lib/ai/redact";
import { getThread, listTickets, raiserRoles } from "@/modules/helpdesk/queries";
import { aiTaskRoute } from "@/modules/ai/task-route";
import { HelpdeskTriageGenerationSchema, HelpdeskTriageRequestSchema, pickSimilarTickets } from "@/modules/ai/task-drafts";
import { buildHelpdeskTriagePrompt, HELPDESK_TRIAGE_INSTRUCTIONS } from "@/modules/ai/prompts/task-drafts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Category + priority + one reply <= 500 chars (lesson 9: always cap output).
const MAX_OUTPUT_TOKENS = 1024;
// Bound the prompt: the latest messages carry the current state of the ticket.
const MAX_MESSAGES = 10;
const MAX_MESSAGE_CHARS = 600;

/** Full names and each name word (3+ letters), for redact()'s deny list. */
function nameTerms(names: readonly (string | null)[]): string[] {
  const full = names.filter((n): n is string => Boolean(n) && n !== "Unknown");
  return [...new Set([...full, ...full.flatMap((n) => n.split(/\s+/))])].filter((w) => w.length >= 3);
}

export const POST = aiTaskRoute({
  route: "helpdesk-triage",
  schema: HelpdeskTriageRequestSchema,
  maxBodyBytes: 4 * 1024,
  permission: "helpdesk.manage",
  capability: "helpdesk_triage",
  run: async (ctx, input) => {
    // Owner query: institution-scoped + RLS, so another tenant's id is simply not found.
    const thread = await getThread(ctx, input.ticketId);
    if (!thread) return fail("not_found", "Ticket not found.");

    const [resolved, closed, roles] = await Promise.all([
      listTickets(ctx, { status: "resolved" }),
      listTickets(ctx, { status: "closed" }),
      raiserRoles(ctx, thread.raisedBy),
    ]);
    const candidates = [...resolved.rows, ...closed.rows];
    const similar = pickSimilarTickets(thread.ticket, candidates);

    const denyNames = nameTerms([
      thread.ticket.raisedByName,
      thread.ticket.assigneeName,
      ...thread.messages.map((m) => m.authorName),
      ...candidates.flatMap((t) => [t.raisedByName, t.assigneeName]),
    ]);
    const clean = (text: string) => redact(text, denyNames).text;

    const prompt = buildHelpdeskTriagePrompt({
      subject: clean(thread.ticket.subject),
      category: thread.ticket.category,
      priority: thread.ticket.priority,
      raiserRole: roles.join("/") || "member",
      messages: thread.messages.slice(-MAX_MESSAGES).map((m) => ({ fromRaiser: m.fromRaiser, body: clean(m.body.slice(0, MAX_MESSAGE_CHARS)) })),
      similar: similar.map((t) => ({ subject: clean(t.subject), category: t.category })),
    });

    const generated = await runStructured({
      ctx,
      feature: "helpdesk_triage",
      schema: HelpdeskTriageGenerationSchema,
      instructions: HELPDESK_TRIAGE_INSTRUCTIONS,
      prompt,
      denyNames,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    if (!generated.ok) return generated;

    const { provider, model, fallback } = generated.data;
    return ok({
      ...generated.data.data,
      similar: similar.map(({ id, subject, category, status }) => ({ id, subject, category, status })),
      provider,
      model,
      fallback,
    });
  },
});
