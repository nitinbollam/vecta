import AsyncStorage from '@react-native-async-storage/async-storage';

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

export const API_V1_BASE = stripTrailingSlash(
  process.env.EXPO_PUBLIC_API_URL ?? 'https://vecta-elaf.onrender.com/api/v1',
);

export function getWsBase(): string {
  const fromEnv = process.env.EXPO_PUBLIC_WS_URL?.trim();
  if (fromEnv) return stripTrailingSlash(fromEnv);
  try {
    const u = new URL(/^https?:\/\//i.test(API_V1_BASE) ? API_V1_BASE : `http://${API_V1_BASE}`);
    const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
    return stripTrailingSlash(`${proto}//${u.host}`);
  } catch {
    return 'wss://vecta-elaf.onrender.com';
  }
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await AsyncStorage.getItem('driver_auth_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}
