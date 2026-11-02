import { describe, it, expect } from "vitest";
import {
  VEHICLE_STATUSES,
  ROUTE_STATUSES,
  VehicleUpsertSchema,
  RouteUpsertSchema,
  StopUpsertSchema,
  TransportAssignSchema,
  TransportUnassignSchema,
  TransportRoutesSchema,
  TransportForStudentSchema,
} from "../../src/modules/transport/schemas";

describe("Transport schemas", () => {
  describe("VehicleUpsertSchema", () => {
    it("parses valid vehicle", () => {
      const result = VehicleUpsertSchema.parse({
        registrationNo: "MH12AB1234",
        capacity: 50,
        driverName: "John Doe",
        status: "active",
      });
      expect(result.registrationNo).toBe("MH12AB1234");
      expect(result.capacity).toBe(50);
      expect(result.driverName).toBe("John Doe");
    });

    it("trims and uppercases registration number with inner spaces removed", () => {
      const result = VehicleUpsertSchema.parse({
        registrationNo: " mh 12 ab 1234 ",
        capacity: 50,
        driverName: "John Doe",
      });
      expect(result.registrationNo).toBe("MH12AB1234");
    });

    it("rejects capacity 0", () => {
      expect(() =>
        VehicleUpsertSchema.parse({
          registrationNo: "MH12AB1234",
          capacity: 0,
          driverName: "John Doe",
        })
      ).toThrow();
    });

    it("rejects capacity 101", () => {
      expect(() =>
        VehicleUpsertSchema.parse({
          registrationNo: "MH12AB1234",
          capacity: 101,
          driverName: "John Doe",
        })
      ).toThrow();
    });

    it("allows optional id", () => {
      const result = VehicleUpsertSchema.parse({
        id: "550e8400-e29b-41d4-a716-446655440000",
        registrationNo: "MH12AB1234",
        capacity: 50,
        driverName: "John Doe",
      });
      expect(result.id).toBe("550e8400-e29b-41d4-a716-446655440000");
    });

    it("rejects unknown keys", () => {
      expect(() =>
        VehicleUpsertSchema.parse({
          registrationNo: "MH12AB1234",
          capacity: 50,
          driverName: "John Doe",
          unknownField: "value",
        })
      ).toThrow();
    });
  });

  describe("RouteUpsertSchema", () => {
    it("parses valid route", () => {
      const result = RouteUpsertSchema.parse({
        name: "Route 1",
        vehicleId: "550e8400-e29b-41d4-a716-446655440000",
        status: "on_time",
      });
      expect(result.name).toBe("Route 1");
      expect(result.vehicleId).toBe("550e8400-e29b-41d4-a716-446655440000");
    });

    it("allows null vehicleId", () => {
      const result = RouteUpsertSchema.parse({
        name: "Route 1",
        vehicleId: null,
      });
      expect(result.vehicleId).toBeNull();
    });

    it("rejects unknown keys", () => {
      expect(() =>
        RouteUpsertSchema.parse({
          name: "Route 1",
          unknownField: "value",
        })
      ).toThrow();
    });
  });

  describe("StopUpsertSchema", () => {
    it("parses valid stop", () => {
      const result = StopUpsertSchema.parse({
        routeId: "550e8400-e29b-41d4-a716-446655440000",
        seq: 1,
        name: "School Gate",
        eta: "07:30",
        mapX: 50,
        mapY: 50,
      });
      expect(result.eta).toBe("07:30");
      expect(result.mapX).toBe(50);
      expect(result.mapY).toBe(50);
    });

    it("rejects invalid eta format '7:5'", () => {
      expect(() =>
        StopUpsertSchema.parse({
          routeId: "550e8400-e29b-41d4-a716-446655440000",
          seq: 1,
          name: "School Gate",
          eta: "7:5",
          mapX: 50,
          mapY: 50,
        })
      ).toThrow();
    });

    it("rejects mapX 101", () => {
      expect(() =>
        StopUpsertSchema.parse({
          routeId: "550e8400-e29b-41d4-a716-446655440000",
          seq: 1,
          name: "School Gate",
          eta: "07:30",
          mapX: 101,
          mapY: 50,
        })
      ).toThrow();
    });

    it("rejects unknown keys", () => {
      expect(() =>
        StopUpsertSchema.parse({
          routeId: "550e8400-e29b-41d4-a716-446655440000",
          seq: 1,
          name: "School Gate",
          eta: "07:30",
          mapX: 50,
          mapY: 50,
          unknownField: "value",
        })
      ).toThrow();
    });
  });

  describe("TransportAssignSchema", () => {
    it("parses valid assignment", () => {
      const result = TransportAssignSchema.parse({
        studentId: "550e8400-e29b-41d4-a716-446655440000",
        stopId: "550e8400-e29b-41d4-a716-446655440001",
      });
      expect(result.studentId).toBe("550e8400-e29b-41d4-a716-446655440000");
      expect(result.stopId).toBe("550e8400-e29b-41d4-a716-446655440001");
    });

    it("rejects unknown keys", () => {
      expect(() =>
        TransportAssignSchema.parse({
          studentId: "550e8400-e29b-41d4-a716-446655440000",
          stopId: "550e8400-e29b-41d4-a716-446655440001",
          unknownField: "value",
        })
      ).toThrow();
    });
  });

  describe("TransportUnassignSchema", () => {
    it("parses valid unassign", () => {
      const result = TransportUnassignSchema.parse({
        studentId: "550e8400-e29b-41d4-a716-446655440000",
      });
      expect(result.studentId).toBe("550e8400-e29b-41d4-a716-446655440000");
    });

    it("rejects unknown keys", () => {
      expect(() =>
        TransportUnassignSchema.parse({
          studentId: "550e8400-e29b-41d4-a716-446655440000",
          unknownField: "value",
        })
      ).toThrow();
    });
  });

  describe("TransportRoutesSchema", () => {
    it("parses empty object", () => {
      const result = TransportRoutesSchema.parse({});
      expect(result).toEqual({});
    });

    it("rejects unknown keys", () => {
      expect(() =>
        TransportRoutesSchema.parse({
          unknownField: "value",
        })
      ).toThrow();
    });
  });

  describe("TransportForStudentSchema", () => {
    it("parses valid query", () => {
      const result = TransportForStudentSchema.parse({
        studentId: "550e8400-e29b-41d4-a716-446655440000",
      });
      expect(result.studentId).toBe("550e8400-e29b-41d4-a716-446655440000");
    });

    it("rejects unknown keys", () => {
      expect(() =>
        TransportForStudentSchema.parse({
          studentId: "550e8400-e29b-41d4-a716-446655440000",
          unknownField: "value",
        })
      ).toThrow();
    });
  });

  describe("Constants", () => {
    it("exports VEHICLE_STATUSES", () => {
      expect(VEHICLE_STATUSES).toBeDefined();
      expect(VEHICLE_STATUSES).toContain("active");
      expect(VEHICLE_STATUSES).toContain("off_road");
    });

    it("exports ROUTE_STATUSES", () => {
      expect(ROUTE_STATUSES).toBeDefined();
      expect(ROUTE_STATUSES).toContain("on_time");
      expect(ROUTE_STATUSES).toContain("delayed");
      expect(ROUTE_STATUSES).toContain("off_road");
    });
  });
});
