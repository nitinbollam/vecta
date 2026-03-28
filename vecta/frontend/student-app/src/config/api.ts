import AsyncStorage from "@react-native-async-storage/async-storage";

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

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await AsyncStorage.getItem("auth_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function getStudentId(): Promise<string | null> {
  return AsyncStorage.getItem("student_id");
}
