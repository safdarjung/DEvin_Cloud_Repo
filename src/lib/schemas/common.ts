// 06 §1.3 — shared Zod primitives. Every action object schema uses `.strict()`.
import { z } from "zod";

export const uuid = z.string().uuid();
export const money = z.number().nonnegative().multipleOf(0.01);
export const isoDate = z.string().date();
export const phoneIN = z.string().regex(/^[6-9]\d{9}$/);
export const shortText = z.string().trim().min(1).max(200);
export const longText = z.string().trim().max(5000);
