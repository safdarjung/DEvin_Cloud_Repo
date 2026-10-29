import { z } from "zod";
import { uuid } from "@/lib/schemas/common";

export const MarkNotificationReadSchema = z.object({ notificationId: uuid }).strict();

export type MarkNotificationReadInput = z.infer<typeof MarkNotificationReadSchema>;
