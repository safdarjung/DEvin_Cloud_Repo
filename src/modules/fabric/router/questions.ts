// F-BE-19 — reusable Laya noul questions for visual routing. Each is a
// yes/no instruction against the UI state; Laya returns noul (P(yes)) per
// question id, consumed by pickVariant in use-visual-route.ts.

export const VISUAL_ROUTE_QUESTIONS = {
  needsChart: {
    type: "noul" as const,
    instructions: "Does this state contain numeric trend or comparison data best shown as a chart?",
  },
  needsTable: {
    type: "noul" as const,
    instructions: "Does this state contain multiple records with shared fields best shown as a comparison table?",
  },
  needsFlowDiagram: {
    type: "noul" as const,
    instructions: "Does this state describe a sequence of steps or a process best shown as a flow diagram?",
  },
  plainTextEnough: {
    type: "noul" as const,
    instructions: "Is this state simple enough that plain text explains it fully, with no chart, table, or diagram needed?",
  },
} satisfies Record<string, { type: "noul"; instructions: string }>;
