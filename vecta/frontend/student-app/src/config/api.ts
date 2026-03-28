/** Normalised API roots — EXPO_PUBLIC_* are inlined at bundle time. */
function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

export const API_V1_BASE = stripTrailingSlash(
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000/api/v1",
);

export const COMPLIANCE_AI_BASE = stripTrailingSlash(
  process.env.EXPO_PUBLIC_COMPLIANCE_AI_URL ?? "http://localhost:3007",
);
