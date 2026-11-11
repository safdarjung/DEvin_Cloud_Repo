// Read-only wrappers over ./queries.ts, exposed at /api/v1/query/schoolLabs.<fn>.
import { defineQuery } from "@/lib/actions/define-query";
import { LabIdQuerySchema, LabsEmptySchema, UtilisationQuerySchema } from "./schemas";
import { schoolLabSafetyWarnings, schoolLabUtilisation, schoolLabs } from "./queries";

export const schoolLabsQuery = defineQuery({
  name: "schoolLabs.labs",
  module: "school_labs",
  schema: LabsEmptySchema,
  permission: "lab.read",
  handler: (_input, ctx) => schoolLabs(ctx),
});

// Name-free aggregate: bookings and periods used per lab.
export const schoolLabUtilisationQuery = defineQuery({
  name: "schoolLabs.utilisation",
  module: "school_labs",
  schema: UtilisationQuerySchema,
  permission: "lab.read",
  handler: (input, ctx) => schoolLabUtilisation(ctx, input),
});

// Deterministic safety check of one lab's register; holds no person names.
export const schoolLabSafetyWarningsQuery = defineQuery({
  name: "schoolLabs.safetyWarnings",
  module: "school_labs",
  schema: LabIdQuerySchema,
  permission: "lab.read",
  handler: ({ labId }, ctx) => schoolLabSafetyWarnings(ctx, labId),
});
