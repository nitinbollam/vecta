import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_V1_BASE, getAuthHeaders } from '../config/api';

export type DriverStatusPayload = {
  hasProfile: boolean;
  id?: string;
  status?: string;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_plate?: string | null;
  is_online?: boolean | null;
  [key: string]: unknown;
};

interface DriverState {
  bootstrapped: boolean;
  authToken: string | null;
  driver: DriverStatusPayload | null;
  setAuthToken: (t: string | null) => Promise<void>;
  setDriver: (d: DriverStatusPayload | null) => void;
  bootstrap: () => Promise<void>;
  refreshDriver: () => Promise<void>;
}

export const useDriverStore = create<DriverState>((set, get) => ({
  bootstrapped: false,
  authToken: null,
  driver: null,

  setAuthToken: async (t) => {
    if (t) await AsyncStorage.setItem('driver_auth_token', t);
    else await AsyncStorage.removeItem('driver_auth_token');
    set({ authToken: t });
  },

  setDriver: (d) => set({ driver: d }),

  bootstrap: async () => {
    const authToken = await AsyncStorage.getItem('driver_auth_token');
    set({ authToken });
    if (authToken) {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${API_V1_BASE}/mobility/driver/status`, { headers });
        if (res.ok) {
          const data = (await res.json()) as DriverStatusPayload;
          set({ driver: data });
        }
      } catch {
        set({ driver: null });
      }
    }
    set({ bootstrapped: true });
  },

  refreshDriver: async () => {
    const { authToken } = get();
    if (!authToken) return;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_V1_BASE}/mobility/driver/status`, { headers });
      if (res.ok) {
        const data = (await res.json()) as DriverStatusPayload;
        set({ driver: data });
      }
    } catch {
      /* ignore */
    }
  },
}));
