import { describe, expect, it } from "vitest";
import {
  detectScheduleConflicts,
  institutionTimeZone,
  localParts,
  type RoomSlot,
  type ScheduledPaper,
} from "@/modules/exams/schedule-conflicts";

const SECTION_A = { id: "sec-a", label: "6-A" };
const SECTION_B = { id: "sec-b", label: "6-B" };

function paper(overrides: Partial<ScheduledPaper> & { id: string }): ScheduledPaper {
  return {
    classSectionId: SECTION_A.id,
    sectionLabel: SECTION_A.label,
    roomId: null,
    roomName: null,
    scheduledAt: "2026-11-02T04:00:00Z", // Mon 09:30 IST
    durationMinutes: 40,
    ...overrides,
  };
}

describe("institutionTimeZone", () => {
  it("reads settings.locale.timezone", () => {
    expect(institutionTimeZone({ locale: { timezone: "Europe/London", currency: "INR" } })).toBe("Europe/London");
  });

  it("falls back to Asia/Kolkata when settings don't parse", () => {
    expect(institutionTimeZone({})).toBe("Asia/Kolkata");
    expect(institutionTimeZone({ locale: { timezone: "" } })).toBe("Asia/Kolkata");
  });
});

describe("localParts", () => {
  it("converts a UTC instant to institution-local date/weekday/time", () => {
    // 2026-11-02T04:00:00Z = Mon 2026-11-02 09:30 IST
    expect(localParts("2026-11-02T04:00:00Z", "Asia/Kolkata")).toEqual({
      date: "2026-11-02",
      weekday: 1,
      hhmm: "09:30",
    });
  });

  it("crosses local midnight correctly", () => {
    // 2026-11-02T19:00:00Z = Tue 2026-11-03 00:30 IST
    expect(localParts("2026-11-02T19:00:00Z", "Asia/Kolkata")).toEqual({
      date: "2026-11-03",
      weekday: 2,
      hhmm: "00:30",
    });
  });
});

describe("detectScheduleConflicts — section_double_booked", () => {
  it("back-to-back papers of one section → none", () => {
    const papers = [
      paper({ id: "p1", scheduledAt: "2026-11-02T04:00:00Z", durationMinutes: 40 }), // 09:30-10:10
      paper({ id: "p2", scheduledAt: "2026-11-02T04:40:00Z", durationMinutes: 40 }), // 10:10-10:50
    ];
    expect(detectScheduleConflicts(papers, [], "Asia/Kolkata")).toEqual([]);
  });

  it("overlapping papers of one section → exactly one section_double_booked", () => {
    const papers = [
      paper({ id: "p1", scheduledAt: "2026-11-02T04:00:00Z", durationMinutes: 40 }), // 09:30-10:10
      paper({ id: "p2", scheduledAt: "2026-11-02T04:30:00Z", durationMinutes: 40 }), // 10:00-10:40
    ];
    const conflicts = detectScheduleConflicts(papers, [], "Asia/Kolkata");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe("section_double_booked");
  });

  it("overlap across different sections → no conflict", () => {
    const papers = [
      paper({ id: "p1", scheduledAt: "2026-11-02T04:00:00Z", durationMinutes: 40 }),
      paper({ id: "p2", scheduledAt: "2026-11-02T04:00:00Z", durationMinutes: 40, classSectionId: SECTION_B.id, sectionLabel: SECTION_B.label }),
    ];
    expect(detectScheduleConflicts(papers, [], "Asia/Kolkata")).toEqual([]);
  });
});

describe("detectScheduleConflicts — room_timetable_clash", () => {
  const mondaySlot: RoomSlot = { roomId: "room-1", weekday: 1, startsAt: "09:00", endsAt: "09:40", label: "P1" };

  it("paper in a room with an overlapping Monday slot → room_timetable_clash", () => {
    const papers = [
      paper({ id: "p1", scheduledAt: "2026-11-02T04:00:00Z", durationMinutes: 40, roomId: "room-1", roomName: "Hall 1" }), // Mon 09:30
    ];
    const conflicts = detectScheduleConflicts(papers, [mondaySlot], "Asia/Kolkata");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe("room_timetable_clash");
  });

  it("same slot on a Tuesday paper → none", () => {
    const papers = [
      paper({ id: "p1", scheduledAt: "2026-11-03T04:00:00Z", durationMinutes: 40, roomId: "room-1", roomName: "Hall 1" }), // Tue 09:30 IST
    ];
    expect(detectScheduleConflicts(papers, [mondaySlot], "Asia/Kolkata")).toEqual([]);
  });

  it("Sunday paper → none", () => {
    const papers = [
      paper({ id: "p1", scheduledAt: "2026-11-01T04:00:00Z", durationMinutes: 40, roomId: "room-1", roomName: "Hall 1" }), // Sun 09:30 IST
    ];
    const sundaySlot: RoomSlot = { roomId: "room-1", weekday: 0 as RoomSlot["weekday"], startsAt: "09:00", endsAt: "09:40", label: "P1" };
    expect(detectScheduleConflicts(papers, [sundaySlot], "Asia/Kolkata")).toEqual([]);
  });

  it("paper without a room → no clash even if time overlaps a slot", () => {
    const papers = [paper({ id: "p1", scheduledAt: "2026-11-02T04:00:00Z", durationMinutes: 40, roomId: null, roomName: null })];
    expect(detectScheduleConflicts(papers, [mondaySlot], "Asia/Kolkata")).toEqual([]);
  });

  it("sorts conflicts by starts_at", () => {
    const papers = [
      paper({ id: "p-late", scheduledAt: "2026-11-02T10:00:00Z", durationMinutes: 40, roomId: "room-1", roomName: "Hall 1" }),
      paper({ id: "p-early", scheduledAt: "2026-11-02T04:00:00Z", durationMinutes: 40, roomId: "room-1", roomName: "Hall 1" }),
    ];
    const slots: RoomSlot[] = [
      mondaySlot,
      { roomId: "room-1", weekday: 1, startsAt: "15:00", endsAt: "16:00", label: "P7" },
    ];
    const conflicts = detectScheduleConflicts(papers, slots, "Asia/Kolkata");
    expect(conflicts.map((c) => c.exam_paper_id)).toEqual(["p-early", "p-late"]);
  });
});
