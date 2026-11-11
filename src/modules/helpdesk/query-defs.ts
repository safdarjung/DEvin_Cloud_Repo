// Read-only wrappers over ./queries.ts, exposed at /api/v1/query/helpdesk.<fn>.
import { z } from "zod";
import { defineQuery } from "@/lib/actions/define-query";
import { TicketListSchema, TicketThreadSchema } from "./schemas";
import { getThread, listTickets, ticketCounts } from "./queries";

export const helpdeskTicketsQuery = defineQuery({
  name: "helpdesk.tickets",
  module: "helpdesk",
  schema: TicketListSchema,
  permission: "helpdesk.manage",
  handler: (input, ctx) => listTickets(ctx, input),
});

export const helpdeskMyTicketsQuery = defineQuery({
  name: "helpdesk.myTickets",
  module: "helpdesk",
  schema: TicketListSchema,
  permission: "helpdesk.raise",
  handler: (input, ctx) => listTickets(ctx, input),
});

export const helpdeskCountsQuery = defineQuery({
  name: "helpdesk.counts",
  module: "helpdesk",
  schema: z.object({}).strict(),
  permission: "helpdesk.manage",
  handler: (_input, ctx) => ticketCounts(ctx),
});

export const helpdeskThreadQuery = defineQuery({
  name: "helpdesk.thread",
  module: "helpdesk",
  schema: TicketThreadSchema,
  permission: "helpdesk.manage",
  handler: (input, ctx) => getThread(ctx, input.ticketId),
});

export const helpdeskMyThreadQuery = defineQuery({
  name: "helpdesk.myThread",
  module: "helpdesk",
  schema: TicketThreadSchema,
  permission: "helpdesk.raise",
  handler: (input, ctx) => getThread(ctx, input.ticketId),
});
