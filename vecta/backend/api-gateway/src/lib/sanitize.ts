/**
 * Free-text sanitization for API inputs (XSS / injection hardening).
 */
import { z } from "zod";

export function stripFreeText(val: string): string {
  return val.replace(/<[^>]*>/g, "").replace(/[<>'"]/g, "");
}

/** Generic user-entered prose (names, addresses, descriptions, notes). */
export function safeText(max: number): z.ZodEffects<z.ZodString, string, string> {
  return z
    .string()
    .trim()
    .max(max)
    .transform((val) => stripFreeText(val));
}

/** Optional free text (empty string → empty after trim). */
export function safeTextOptional(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .transform((val) => stripFreeText(val))
    .optional();
}
