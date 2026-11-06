// X06-T6/T8 — read-only wrappers over ./queries.ts, exposed at
// /api/v1/query/examSeating.<fn> (mirrors src/modules/timetable/query-defs.ts;
// the two HTML defs mirror exams/query-defs.ts's reportCardHtmlQuery).
import { defineQuery } from "@/lib/actions/define-query";
import { renderAdmitCardsHtml, renderSeatingChartHtml } from "./html";
import { AdmitCardsSchema, PlanIdSchema, SlotsQuerySchema, StudentSeatsSchema } from "./schemas";
import { getAdmitCards, getSeatingChart, listSeatingSlots, listStudentSeats } from "./queries";

export const examSeatingSlotsQuery = defineQuery({
  name: "examSeating.slots",
  module: "exam_seating",
  schema: SlotsQuerySchema,
  permission: "exam.seating.read",
  handler: (input, ctx) => listSeatingSlots(ctx, input.examId),
});

export const examSeatingChartQuery = defineQuery({
  name: "examSeating.chart",
  module: "exam_seating",
  schema: PlanIdSchema,
  permission: "exam.seating.read",
  handler: (input, ctx) => getSeatingChart(ctx, input.planId),
});

export const examSeatingStudentSeatsQuery = defineQuery({
  name: "examSeating.studentSeats",
  module: "exam_seating",
  schema: StudentSeatsSchema,
  permission: "exam.seating.read",
  handler: (input, ctx) => listStudentSeats(ctx, input.studentId),
});

export const examSeatingChartHtmlQuery = defineQuery({
  name: "examSeating.chartHtml",
  module: "exam_seating",
  schema: PlanIdSchema,
  permission: "exam.seating.read",
  handler: async (input, ctx) => {
    const chart = await getSeatingChart(ctx, input.planId);
    return chart ? { html: renderSeatingChartHtml(chart) } : null;
  },
});

export const examSeatingAdmitCardsHtmlQuery = defineQuery({
  name: "examSeating.admitCardsHtml",
  module: "exam_seating",
  schema: AdmitCardsSchema,
  permission: "exam.seating.read",
  handler: async (input, ctx) => {
    const cards = await getAdmitCards(ctx, input);
    return cards.length > 0 ? { html: renderAdmitCardsHtml(cards) } : null;
  },
});
