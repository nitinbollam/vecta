import AsyncStorage from '@react-native-async-storage/async-storage';

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

export const API_V1_BASE = stripTrailingSlash(
  process.env.EXPO_PUBLIC_API_URL ?? 'https://vecta-elaf.onrender.com/api/v1',
);

export function getWsBase(): string {
  const fromEnv = process.env.EXPO_PUBLIC_WS_URL?.trim();
  let url: string;
  if (fromEnv) {
    url = stripTrailingSlash(fromEnv);
  } else {
    const base = API_V1_BASE.replace(/\/api\/v1\/?$/i, '');
    url = base
      .replace(/^https:\/\//i, 'wss://')
      .replace(/^http:\/\//i, 'ws://');
    if (!/^wss?:\/\//i.test(url)) {
      try {
        const u = new URL(/^https?:\/\//i.test(API_V1_BASE) ? API_V1_BASE : `https://${API_V1_BASE}`);
        const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
        url = stripTrailingSlash(`${proto}//${u.host}`);
      } catch {
        url = 'ws://localhost:4000';
      }
    }
  }
  if (process.env.NODE_ENV === 'production' && url.startsWith('ws://')) {
    return url.replace('ws://', 'wss://');
  }
  return url;
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await AsyncStorage.getItem('driver_auth_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function getDriverId(): Promise<string | null> {
  return AsyncStorage.getItem('driver_id');
}
