// F18 §H — /api/v1/query/core.setup.status (same gate as the setup page).
import { z } from "zod";
import { defineQuery } from "@/lib/actions/define-query";
import { getSetupStatus } from "./queries";

export const setupStatusQuery = defineQuery({
  name: "core.setup.status",
  module: "core",
  schema: z.object({}).strict(),
  permission: "institution.settings.manage",
  handler: (_input, ctx) => getSetupStatus(ctx),
});
