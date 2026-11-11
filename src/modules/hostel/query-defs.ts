// Read-only wrappers over ./queries.ts, exposed at /api/v1/query/hostel.<fn>.
import { defineQuery } from "@/lib/actions/define-query";
import { HostelEmptySchema, HostelRollCallQuerySchema } from "./schemas";
import { hostelAllocations, hostelRollCall, hostelRooms } from "./queries";

export const hostelRoomsQuery = defineQuery({
  name: "hostel.rooms",
  module: "hostel",
  schema: HostelEmptySchema,
  permission: "hostel.read",
  handler: (_input, ctx) => hostelRooms(ctx),
});

export const hostelAllocationsQuery = defineQuery({
  name: "hostel.allocations",
  module: "hostel",
  schema: HostelEmptySchema,
  permission: "hostel.read",
  handler: (_input, ctx) => hostelAllocations(ctx),
});

export const hostelRollCallQuery = defineQuery({
  name: "hostel.rollCall",
  module: "hostel",
  schema: HostelRollCallQuerySchema,
  permission: "hostel.read",
  handler: (input, ctx) => hostelRollCall(ctx, input),
});
