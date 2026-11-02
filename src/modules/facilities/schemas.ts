// M13-T3 — Zod schemas for facilities.* actions. Relative + .ts import: mirrors
// src/modules/notifications/announcements.schemas.ts (seed-script safe).
import { z } from "zod";
import { uuid } from "../../lib/schemas/common.ts";

export const ASSET_CATEGORIES = [
  "furniture",
  "electrical",
  "it",
  "lab",
  "sports",
  "plumbing",
  "vehicle",
  "other",
] as const;

export const ASSET_STATUSES = ["in_use", "under_repair", "retired"] as const;

export const MAINTENANCE_PRIORITIES = ["low", "medium", "high"] as const;

export const MAINTENANCE_STATUSES = ["open", "in_progress", "done"] as const;

export const AssetUpsertSchema = z
  .object({
    id: uuid.optional(),
    name: z.string().trim().min(1).max(80),
    category: z.enum(ASSET_CATEGORIES),
    assetTag: z.string().trim().min(1).max(40).optional(),
    roomId: uuid.optional(),
    location: z.string().trim().min(1).max(80).optional(),
    status: z.enum(ASSET_STATUSES).optional(),
  })
  .strict();
export type AssetUpsertInput = z.infer<typeof AssetUpsertSchema>;

export const MaintenanceRequestSchema = z
  .object({
    assetId: uuid.optional(),
    location: z.string().trim().min(1).max(80).optional(),
    issue: z.string().trim().min(1).max(500),
    priority: z.enum(MAINTENANCE_PRIORITIES).default("medium"),
  })
  .strict()
  .refine((data) => data.assetId || data.location, {
    message: "Either assetId or location must be provided",
    path: ["assetId"],
  });
export type MaintenanceRequestInput = z.infer<typeof MaintenanceRequestSchema>;

export const MaintenanceAssignSchema = z
  .object({
    requestId: uuid,
    assigneeStaffId: uuid,
  })
  .strict();
export type MaintenanceAssignInput = z.infer<typeof MaintenanceAssignSchema>;

export const MaintenanceCloseSchema = z
  .object({
    requestId: uuid,
    resolutionNote: z.string().trim().max(500).optional(),
  })
  .strict();
export type MaintenanceCloseInput = z.infer<typeof MaintenanceCloseSchema>;

export const AssetListSchema = z
  .object({
    roomId: uuid.optional(),
    status: z.enum(ASSET_STATUSES).optional(),
  })
  .strict();
export type AssetListInput = z.infer<typeof AssetListSchema>;

export const MaintenanceListSchema = z
  .object({
    status: z.enum(MAINTENANCE_STATUSES).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict();
export type MaintenanceListInput = z.infer<typeof MaintenanceListSchema>;
