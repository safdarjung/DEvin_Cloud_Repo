import { describe, expect, it } from "vitest";
import {
  HostelAllocateSchema,
  HostelRollCallSaveSchema,
  HostelRoomCreateSchema,
  HostelRoomUpdateSchema,
  HostelVacateSchema,
} from "@/modules/hostel/schemas";

const U = "00000000-0000-4000-8000-000000000001";
const V = "00000000-0000-4000-8000-000000000002";

describe("hostel schemas", () => {
  it("room create accepts a normal room and trims text", () => {
    const r = HostelRoomCreateSchema.parse({ block: " A ", roomNo: "101", capacity: 4 });
    expect(r.block).toBe("A");
  });
  it("room create rejects capacity 0 and 51", () => {
    expect(HostelRoomCreateSchema.safeParse({ block: "A", roomNo: "1", capacity: 0 }).success).toBe(false);
    expect(HostelRoomCreateSchema.safeParse({ block: "A", roomNo: "1", capacity: 51 }).success).toBe(false);
  });
  it("room create rejects unknown keys", () => {
    expect(HostelRoomCreateSchema.safeParse({ block: "A", roomNo: "1", capacity: 2, x: 1 }).success).toBe(false);
  });
  it("room update needs id and isActive", () => {
    expect(HostelRoomUpdateSchema.safeParse({ id: U, block: "A", roomNo: "1", capacity: 2, isActive: true }).success).toBe(true);
    expect(HostelRoomUpdateSchema.safeParse({ block: "A", roomNo: "1", capacity: 2, isActive: true }).success).toBe(false);
  });
  it("allocate and vacate need uuids", () => {
    expect(HostelAllocateSchema.safeParse({ roomId: U, studentId: V }).success).toBe(true);
    expect(HostelAllocateSchema.safeParse({ roomId: "x", studentId: V }).success).toBe(false);
    expect(HostelVacateSchema.safeParse({ allocationId: U }).success).toBe(true);
  });
  it("roll call rejects unknown session, unknown status, empty and duplicate entries", () => {
    const ok = { takenOn: "2026-11-10", session: "night", entries: [{ studentId: U, status: "absent" }] };
    expect(HostelRollCallSaveSchema.safeParse(ok).success).toBe(true);
    expect(HostelRollCallSaveSchema.safeParse({ ...ok, session: "noon" }).success).toBe(false);
    expect(HostelRollCallSaveSchema.safeParse({ ...ok, entries: [{ studentId: U, status: "late" }] }).success).toBe(false);
    expect(HostelRollCallSaveSchema.safeParse({ ...ok, entries: [] }).success).toBe(false);
    expect(
      HostelRollCallSaveSchema.safeParse({ ...ok, entries: [{ studentId: U, status: "present" }, { studentId: U, status: "absent" }] }).success,
    ).toBe(false);
  });
});
