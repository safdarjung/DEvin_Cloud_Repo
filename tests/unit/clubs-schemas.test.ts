import { describe, expect, it } from "vitest";
import {
  AwardPointsSchema,
  ClubCreateSchema,
  ClubEventCreateSchema,
  ClubMembershipSchema,
  ClubUpdateSchema,
  HouseCreateSchema,
} from "@/modules/clubs/schemas";

const id = "6f1f6f0e-5b1f-4a53-9d5e-0c1d2e3f4a5b";

describe("clubs schemas", () => {
  it("accepts a minimal club and trims the name", () => {
    expect(ClubCreateSchema.parse({ name: "  Chess  " }).name).toBe("Chess");
  });
  it("rejects an empty club name and capacity 0", () => {
    expect(ClubCreateSchema.safeParse({ name: " " }).success).toBe(false);
    expect(ClubCreateSchema.safeParse({ name: "X", capacity: 0 }).success).toBe(false);
  });
  it("rejects unknown keys", () => {
    expect(ClubCreateSchema.safeParse({ name: "X", institution_id: id }).success).toBe(false);
  });
  it("allows nulling optional club fields on update", () => {
    expect(ClubUpdateSchema.safeParse({ id, patronStaffId: null, capacity: null, description: null }).success).toBe(true);
  });
  it("rejects an event that ends before it starts", () => {
    const base = { clubId: id, title: "T", startsAt: "2030-01-01T10:00:00+05:30" };
    expect(ClubEventCreateSchema.safeParse({ ...base, endsAt: "2030-01-01T09:00:00+05:30" }).success).toBe(false);
    expect(ClubEventCreateSchema.safeParse({ ...base, endsAt: "2030-01-01T11:00:00+05:30" }).success).toBe(true);
  });
  it("rejects sign-up closing after the event starts", () => {
    expect(ClubEventCreateSchema.safeParse({ clubId: id, title: "T", startsAt: "2030-01-01T10:00:00+05:30", signupClosesAt: "2030-01-01T12:00:00+05:30" }).success).toBe(false);
  });
  it("validates house colour as hex", () => {
    expect(HouseCreateSchema.safeParse({ name: "Red", colour: "#DC2626" }).success).toBe(true);
    expect(HouseCreateSchema.safeParse({ name: "Red", colour: "red" }).success).toBe(false);
  });
  it("bounds house points: non-zero integer within +-100", () => {
    const ok = { houseId: id, reason: "Won" };
    expect(AwardPointsSchema.safeParse({ ...ok, points: 5 }).success).toBe(true);
    expect(AwardPointsSchema.safeParse({ ...ok, points: -100 }).success).toBe(true);
    for (const points of [0, 101, -101, 1.5]) expect(AwardPointsSchema.safeParse({ ...ok, points }).success).toBe(false);
  });
  it("requires uuids for membership", () => {
    expect(ClubMembershipSchema.safeParse({ clubId: "x", studentId: id }).success).toBe(false);
  });
});
