// M13-T4 — zod schemas for transport.* actions. Relative + .ts import: seed-script safe.
import { z } from "zod";
import { uuid } from "../../lib/schemas/common.ts";

export const VEHICLE_STATUSES = ["active", "off_road"] as const;
export const ROUTE_STATUSES = ["on_time", "delayed", "off_road"] as const;

const timePattern = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Invalid time format, use HH:MM");

export const VehicleUpsertSchema = z
  .object({
    id: uuid.optional(),
    registrationNo: z
      .string()
      .trim()
      .transform((val) => val.replace(/\s+/g, "").toUpperCase())
      .pipe(z.string().min(1).max(20)),
    capacity: z.number().int().min(1).max(100),
    driverName: z.string().trim().min(1).max(80),
    status: z.enum(VEHICLE_STATUSES).optional(),
  })
  .strict();
export type VehicleUpsertInput = z.infer<typeof VehicleUpsertSchema>;

export const RouteUpsertSchema = z
  .object({
    id: uuid.optional(),
    name: z.string().trim().min(1).max(60),
    vehicleId: uuid.nullable().optional(),
    status: z.enum(ROUTE_STATUSES).optional(),
  })
  .strict();
export type RouteUpsertInput = z.infer<typeof RouteUpsertSchema>;

export const StopUpsertSchema = z
  .object({
    id: uuid.optional(),
    routeId: uuid,
    seq: z.number().int().min(1).max(50),
    name: z.string().trim().min(1).max(80),
    eta: timePattern,
    mapX: z.number().int().min(0).max(100),
    mapY: z.number().int().min(0).max(100),
  })
  .strict();
export type StopUpsertInput = z.infer<typeof StopUpsertSchema>;

export const TransportAssignSchema = z
  .object({
    studentId: uuid,
    stopId: uuid,
  })
  .strict();
export type TransportAssignInput = z.infer<typeof TransportAssignSchema>;

export const TransportUnassignSchema = z
  .object({
    studentId: uuid,
  })
  .strict();
export type TransportUnassignInput = z.infer<typeof TransportUnassignSchema>;

export const TransportRoutesSchema = z.object({}).strict();
export type TransportRoutesInput = z.infer<typeof TransportRoutesSchema>;

export const TransportForStudentSchema = z
  .object({
    studentId: uuid,
  })
  .strict();
export type TransportForStudentInput = z.infer<
  typeof TransportForStudentSchema
>;
