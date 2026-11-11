// Read-only wrappers over ./queries.ts at /api/v1/query/health.<fn>.
import { defineQuery } from "@/lib/actions/define-query";
import { HealthStudentSchema } from "./schemas";
import { healthProfile, healthVaccinations, healthVisits } from "./queries";

export const healthProfileQuery = defineQuery({
  name: "health.profile",
  module: "health",
  schema: HealthStudentSchema,
  permission: "health.read",
  handler: (input, ctx) => healthProfile(ctx, input.studentId),
});

export const healthVisitsQuery = defineQuery({
  name: "health.visits",
  module: "health",
  schema: HealthStudentSchema,
  permission: "health.read",
  handler: (input, ctx) => healthVisits(ctx, input.studentId),
});

export const healthVaccinationsQuery = defineQuery({
  name: "health.vaccinations",
  module: "health",
  schema: HealthStudentSchema,
  permission: "health.read",
  handler: (input, ctx) => healthVaccinations(ctx, input.studentId),
});
