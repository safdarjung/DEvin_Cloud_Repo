// 06 §1.3 — shared Zod primitives. Every action object schema uses `.strict()`.
import { z } from "zod";

export const uuid = z.string().uuid();
export const money = z.number().nonnegative().multipleOf(0.01);
export const isoDate = z.string().date();
// Calendar date not after today in IST (en-CA formats as YYYY-MM-DD, so string compare is date order).
export const notFutureDate = isoDate.refine(
  (d) => d <= new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()),
  "Date cannot be in the future.",
);
export const phoneIN = z.string().regex(/^[6-9]\d{9}$/);
export const shortText = z.string().trim().min(1).max(200);
export const longText = z.string().trim().max(5000);
