// Features-18 #6 — read wrappers exposed at /api/v1/query/clubs.<fn>.
// Name-free aggregates: clubs.list, clubs.events, clubs.houseLeaderboard (names/ids of houses only).
// clubs.members carries student names: local-only.
import { defineQuery } from "@/lib/actions/define-query";
import { ClubMembersQuerySchema, ClubsEmptySchema } from "./schemas";
import { clubEventsList, clubMembersList, clubsList, housesLeaderboard } from "./queries";

export const clubsListQuery = defineQuery({
  name: "clubs.list",
  module: "clubs",
  schema: ClubsEmptySchema,
  permission: "club.read",
  handler: (_input, ctx) => clubsList(ctx),
});

export const clubsEventsQuery = defineQuery({
  name: "clubs.events",
  module: "clubs",
  schema: ClubsEmptySchema,
  permission: "club.read",
  handler: (_input, ctx) => clubEventsList(ctx),
});

export const clubsMembersQuery = defineQuery({
  name: "clubs.members",
  module: "clubs",
  schema: ClubMembersQuerySchema,
  permission: "club.read",
  handler: (input, ctx) => clubMembersList(ctx, input.clubId),
});

export const clubsHouseLeaderboardQuery = defineQuery({
  name: "clubs.houseLeaderboard",
  module: "clubs",
  schema: ClubsEmptySchema,
  permission: "club.read",
  handler: async (_input, ctx) => (await housesLeaderboard(ctx)).map((h) => ({ id: h.id, name: h.name, points: h.points, memberCount: h.members.length })),
});
