import AsyncStorage from "@react-native-async-storage/async-storage";

/** Normalised API roots — EXPO_PUBLIC_* are inlined at bundle time. */
function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

export const API_V1_BASE = stripTrailingSlash(
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000/api/v1",
);

/** WebSocket origin (no path). Ride channel: `${getWsBase()}/ws/ride/:rideId?role=rider` */
export function getWsBase(): string {
  const fromEnv = process.env.EXPO_PUBLIC_WS_URL?.trim();
  if (fromEnv) return stripTrailingSlash(fromEnv);
  const api = API_V1_BASE;
  try {
    const u = new URL(/^https?:\/\//i.test(api) ? api : `http://${api}`);
    const proto = u.protocol === "https:" ? "wss:" : "ws:";
    return stripTrailingSlash(`${proto}//${u.host}`);
  } catch {
    return "ws://localhost:4000";
  }
}

export const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? "";

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
