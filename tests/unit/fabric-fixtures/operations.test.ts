import { describe, it, expect } from "vitest";
import {
  timetableConflicts,
  teacherWorkloads,
  transportRoutes,
  maintenanceRequests,
  roomUtilisation,
} from "@/modules/fabric/demo/operations";
import type { FixtureOpts } from "@/modules/fabric/demo/prng";

describe("fabric operations fixtures", () => {
  const now = new Date("2026-10-31");
  const opts: FixtureOpts = { seed: 42, now, institutionId: "test-inst" };

  describe("timetableConflicts", () => {
    it("returns 7 conflicts with all 4 kinds", () => {
      const conflicts = timetableConflicts(opts);
      expect(conflicts).toHaveLength(7);

      const kinds = conflicts.map((c) => c.kind);
      expect(kinds).toContain("teacher_double_booked");
      expect(kinds).toContain("room_double_booked");
      expect(kinds).toContain("teacher_unavailable");
      expect(kinds).toContain("room_capacity");
    });

    it("has periods between 1 and 8", () => {
      const conflicts = timetableConflicts(opts);
      conflicts.forEach((c) => {
        expect(c.period).toBeGreaterThanOrEqual(1);
        expect(c.period).toBeLessThanOrEqual(8);
      });
    });

    it("has days Mon-Sat", () => {
      const conflicts = timetableConflicts(opts);
      const validDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      conflicts.forEach((c) => {
        expect(validDays).toContain(c.day);
      });
    });

    it("is deterministic", () => {
      const first = timetableConflicts(opts);
      const second = timetableConflicts(opts);
      expect(first).toEqual(second);
    });

    it("strings are at most 200 chars", () => {
      const conflicts = timetableConflicts(opts);
      conflicts.forEach((c) => {
        expect(c.suggestion.length).toBeLessThanOrEqual(200);
        c.entities.forEach((e) => {
          expect(e.length).toBeLessThanOrEqual(200);
        });
      });
    });
  });

  describe("teacherWorkloads", () => {
    it("returns 24 teachers", () => {
      const workloads = teacherWorkloads(opts);
      expect(workloads).toHaveLength(24);
    });

    it("periods_week is at most max_periods (30)", () => {
      const workloads = teacherWorkloads(opts);
      workloads.forEach((w) => {
        expect(w.periods_week).toBeLessThanOrEqual(w.max_periods);
        expect(w.max_periods).toBe(30);
      });
    });

    it("has some teachers over 28 periods", () => {
      const workloads = teacherWorkloads(opts);
      const overLoaded = workloads.filter((w) => w.periods_week > 28);
      expect(overLoaded.length).toBeGreaterThan(0);
    });

    it("is deterministic", () => {
      const first = teacherWorkloads(opts);
      const second = teacherWorkloads(opts);
      expect(first).toEqual(second);
    });

    it("names are at most 200 chars", () => {
      const workloads = teacherWorkloads(opts);
      workloads.forEach((w) => {
        expect(w.name.length).toBeLessThanOrEqual(200);
      });
    });
  });

  describe("transportRoutes", () => {
    it("returns 5 routes", () => {
      const routes = transportRoutes(opts);
      expect(routes).toHaveLength(5);
    });

    it("each route has 5-8 stops", () => {
      const routes = transportRoutes(opts);
      routes.forEach((r) => {
        expect(r.stops.length).toBeGreaterThanOrEqual(5);
        expect(r.stops.length).toBeLessThanOrEqual(8);
      });
    });

    it("stop coordinates are within 0-100", () => {
      const routes = transportRoutes(opts);
      routes.forEach((r) => {
        r.stops.forEach((s) => {
          expect(s.x).toBeGreaterThanOrEqual(0);
          expect(s.x).toBeLessThanOrEqual(100);
          expect(s.y).toBeGreaterThanOrEqual(0);
          expect(s.y).toBeLessThanOrEqual(100);
        });
      });
    });

    it("one route is delayed", () => {
      const routes = transportRoutes(opts);
      const delayed = routes.filter((r) => r.status === "delayed");
      expect(delayed).toHaveLength(1);
    });

    it("assigned is at most capacity", () => {
      const routes = transportRoutes(opts);
      routes.forEach((r) => {
        expect(r.assigned).toBeLessThanOrEqual(r.capacity);
      });
    });

    it("is deterministic", () => {
      const first = transportRoutes(opts);
      const second = transportRoutes(opts);
      expect(first).toEqual(second);
    });
  });

  describe("maintenanceRequests", () => {
    it("returns 10 requests", () => {
      const requests = maintenanceRequests(opts);
      expect(requests).toHaveLength(10);
    });

    it("priority is low, medium, or high", () => {
      const requests = maintenanceRequests(opts);
      const validPriorities = ["low", "medium", "high"];
      requests.forEach((r) => {
        expect(validPriorities).toContain(r.priority);
      });
    });

    it("status is open, in_progress, or done", () => {
      const requests = maintenanceRequests(opts);
      const validStatuses = ["open", "in_progress", "done"];
      requests.forEach((r) => {
        expect(validStatuses).toContain(r.status);
      });
    });

    it("is deterministic", () => {
      const first = maintenanceRequests(opts);
      const second = maintenanceRequests(opts);
      expect(first).toEqual(second);
    });

    it("strings are at most 200 chars", () => {
      const requests = maintenanceRequests(opts);
      requests.forEach((r) => {
        expect(r.asset.length).toBeLessThanOrEqual(200);
        expect(r.location.length).toBeLessThanOrEqual(200);
        expect(r.issue.length).toBeLessThanOrEqual(200);
        if (r.assignee) {
          expect(r.assignee.length).toBeLessThanOrEqual(200);
        }
      });
    });
  });

  describe("roomUtilisation", () => {
    it("returns 18 rooms", () => {
      const rooms = roomUtilisation(opts);
      expect(rooms).toHaveLength(18);
    });

    it("includes labs and library", () => {
      const rooms = roomUtilisation(opts);
      const roomNames = rooms.map((r) => r.room);
      expect(roomNames.some((n) => n.includes("Lab"))).toBe(true);
      expect(roomNames).toContain("Library");
    });

    it("periods_used is at most periods_total", () => {
      const rooms = roomUtilisation(opts);
      rooms.forEach((r) => {
        expect(r.periods_used).toBeLessThanOrEqual(r.periods_total);
      });
    });

    it("is deterministic", () => {
      const first = roomUtilisation(opts);
      const second = roomUtilisation(opts);
      expect(first).toEqual(second);
    });

    it("room names are at most 200 chars", () => {
      const rooms = roomUtilisation(opts);
      rooms.forEach((r) => {
        expect(r.room.length).toBeLessThanOrEqual(200);
      });
    });
  });
});
