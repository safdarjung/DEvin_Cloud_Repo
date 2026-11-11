// Hostel — Zod schemas. Relative + .ts import: seed-script safe.
import { z } from "zod";
import { uuid, isoDate } from "../../lib/schemas/common.ts";

export const ROLL_CALL_SESSIONS = ["morning", "evening", "night"] as const;
export const ROLL_CALL_STATUSES = ["present", "absent", "on_leave"] as const;

const block = z.string().trim().min(1).max(60);
const roomNo = z.string().trim().min(1).max(20);
const capacity = z.number().int().min(1).max(50);

export const HostelRoomCreateSchema = z.object({ block, roomNo, capacity }).strict();

export const HostelRoomUpdateSchema = z
  .object({ id: uuid, block, roomNo, capacity, isActive: z.boolean() })
  .strict();

export const HostelAllocateSchema = z.object({ roomId: uuid, studentId: uuid }).strict();

export const HostelVacateSchema = z.object({ allocationId: uuid }).strict();

export const HostelRollCallSaveSchema = z
  .object({
    takenOn: isoDate,
    session: z.enum(ROLL_CALL_SESSIONS),
    entries: z
      .array(
        z
          .object({
            studentId: uuid,
            status: z.enum(ROLL_CALL_STATUSES),
            note: z.string().trim().min(1).max(200).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict()
  .refine((d) => new Set(d.entries.map((e) => e.studentId)).size === d.entries.length, {
    message: "Each student may appear once",
    path: ["entries"],
  });

export const HostelRollCallQuerySchema = z
  .object({ takenOn: isoDate, session: z.enum(ROLL_CALL_SESSIONS) })
  .strict();

export const HostelEmptySchema = z.object({}).strict();

export type HostelRoomCreateInput = z.infer<typeof HostelRoomCreateSchema>;
export type HostelRoomUpdateInput = z.infer<typeof HostelRoomUpdateSchema>;
export type HostelAllocateInput = z.infer<typeof HostelAllocateSchema>;
export type HostelVacateInput = z.infer<typeof HostelVacateSchema>;
export type HostelRollCallSaveInput = z.infer<typeof HostelRollCallSaveSchema>;
export type HostelRollCallQueryInput = z.infer<typeof HostelRollCallQuerySchema>;
