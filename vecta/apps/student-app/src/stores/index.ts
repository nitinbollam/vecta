/**
 * stores/index.ts — Zustand state stores for Vecta Student App
 *
 * Stores:
 *   useStudentStore    — identity, KYC status, Vecta ID token
 *   useBalanceStore    — Unit.co balance (masked)
 *   useHousingStore    — Nova Credit score, LoC, Plaid status
 *   useMobilityStore   — fleet vehicles, YTD earnings, DSO memos
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ---------------------------------------------------------------------------
// API client helper
// ---------------------------------------------------------------------------

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

async function apiGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

async function apiPost<T>(path: string, body: unknown, token: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Student / Identity Store
// ---------------------------------------------------------------------------

export type KYCStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'MANUAL_REVIEW';
export type StudentRole = 'STUDENT' | 'LESSOR';
export type VectaIDStatus = 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'EXPIRED';

export interface StudentProfile {
  id: string;
  fullName: string;
  universityName: string;
  programOfStudy: string;
  visaStatus: string;
  visaValidThrough: string;
  kycStatus: KYCStatus;
  vectaIdStatus: VectaIDStatus;
  role: StudentRole;
  selfieUrl?: string;          // 15-min signed URL — refreshed on load
  vectaIdToken?: string;
  sevisId?: string;            // locally stored for DSO memo generation only
}

interface StudentState {
  profile: StudentProfile | null;
  authToken: string | null;
  isLoading: boolean;
  error: string | null;
  // Actions
  setAuthToken: (token: string) => void;
  fetchProfile: () => Promise<void>;
  refreshSelfieUrl: () => Promise<void>;
  mintVectaIdToken: () => Promise<void>;
  clearSession: () => void;
}

export const useStudentStore = create<StudentState>()(
  persist(
    (set, get) => ({
      profile:   null,
      authToken: null,
      isLoading: false,
      error:     null,

      setAuthToken: (token) => set({ authToken: token }),

      fetchProfile: async () => {
        const token = get().authToken;
        if (!token) return;

        set({ isLoading: true, error: null });
        try {
          const data = await apiGet<StudentProfile>('/identity/profile', token);
          set({ profile: data, isLoading: false });
        } catch (err) {
          set({ error: (err as Error).message, isLoading: false });
        }
      },

      refreshSelfieUrl: async () => {
        const token = get().authToken;
        if (!token) return;

        try {
          const { url } = await apiGet<{ url: string }>('/identity/selfie-url', token);
          set((state) => ({
            profile: state.profile ? { ...state.profile, selfieUrl: url } : null,
          }));
        } catch { /* non-critical */ }
      },

      mintVectaIdToken: async () => {
        const token = get().authToken;
        if (!token) return;

        set({ isLoading: true, error: null });
        try {
          const { token: vectaToken } = await apiPost<{ token: string }>(
            '/identity/token/mint',
            {},
            token,
          );
          set((state) => ({
            profile: state.profile ? { ...state.profile, vectaIdToken: vectaToken } : null,
            isLoading: false,
          }));
        } catch (err) {
          set({ error: (err as Error).message, isLoading: false });
        }
      },

      clearSession: () =>
        set({ profile: null, authToken: null, error: null }),
    }),
    {
      name: 'vecta-student-store',
      storage: createJSONStorage(() => AsyncStorage),
      // Never persist the auth token or selfie URL in AsyncStorage
      partialize: (state) => ({
        profile: state.profile
          ? {
              ...state.profile,
              selfieUrl: undefined,      // signed URL — never cached
              vectaIdToken: undefined,   // JWT — never cached to disk
            }
          : null,
      }),
    },
  ),
);

// ---------------------------------------------------------------------------
// Balance Store (Unit.co)
// ---------------------------------------------------------------------------

export interface MaskedBalance {
  tier: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  rangeLabel: string;         // e.g. "$5,000 – $10,000"
  lastUpdated: string;
  unitAccountLast4?: string;
}

interface BalanceState {
  balance: MaskedBalance | null;
  isLoading: boolean;
  fetchBalance: () => Promise<void>;
}

export const useBalanceStore = create<BalanceState>()((set, _get) => ({
  balance:   null,
  isLoading: false,

  fetchBalance: async () => {
    const token = useStudentStore.getState().authToken;
    if (!token) return;

    set({ isLoading: true });
    try {
      const data = await apiGet<MaskedBalance>('/identity/banking/balance', token);
      set({ balance: data, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },
}));

// ---------------------------------------------------------------------------
// Housing Store
// ---------------------------------------------------------------------------

export interface TrustScore {
  score: number;
  tier: 'Building' | 'Fair' | 'Good' | 'Excellent';
  cachedAt?: string;
}

export interface LetterOfCredit {
  id: string;
  status: 'pending' | 'active' | 'expired';
  monthlyRent: number;
  guaranteeMonths: number;
  expiresAt: string;
  downloadUrl?: string;
}

interface HousingState {
  trustScore:      TrustScore | null;
  activeLoC:       LetterOfCredit | null;
  plaidConnected:  boolean;
  isLoading:       boolean;
  error:           string | null;
  fetchTrustScore: () => Promise<void>;
  generateLoC:     (monthlyRent: number, landlordName?: string) => Promise<void>;
  refreshLoCUrl:   (locId: string) => Promise<void>;
}

export const useHousingStore = create<HousingState>()((set, _get) => ({
  trustScore:     null,
  activeLoC:      null,
  plaidConnected: false,
  isLoading:      false,
  error:          null,

  fetchTrustScore: async () => {
    const token = useStudentStore.getState().authToken;
    if (!token) return;

    set({ isLoading: true });
    try {
      const data = await apiGet<TrustScore>('/housing/trust-score', token);
      set({ trustScore: data, isLoading: false });
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
    }
  },

  generateLoC: async (monthlyRent, landlordName) => {
    const token = useStudentStore.getState().authToken;
    if (!token) return;

    set({ isLoading: true, error: null });
    try {
      const loc = await apiPost<LetterOfCredit>(
        '/housing/loc/generate',
        { monthlyRent, landlordName },
        token,
      );
      set({ activeLoC: loc, isLoading: false });
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
    }
  },

  refreshLoCUrl: async (locId) => {
    const token = useStudentStore.getState().authToken;
    if (!token) return;

    try {
      const { url } = await apiGet<{ url: string }>(`/housing/loc/${locId}/download`, token);
      set((state) => ({
        activeLoC: state.activeLoC ? { ...state.activeLoC, downloadUrl: url } : null,
      }));
    } catch { /* non-critical */ }
  },
}));

// ---------------------------------------------------------------------------
// Mobility Store
// ---------------------------------------------------------------------------

export interface EnrolledVehicle {
  id: string;
  vehicleVin: string;
  vehicleYear: number;
  vehicleMake: string;
  vehicleModel: string;
  status: 'active' | 'inactive';
}

export interface EarningsSummary {
  taxYear: number;
  ytdRentalIncome: number;
  rideCount: number;
  activeSince: string | null;
  taxClassification: string;
}

interface MobilityState {
  vehicles:        EnrolledVehicle[];
  earnings:        EarningsSummary | null;
  dsoMemoUrl:      string | null;
  isLoading:       boolean;
  error:           string | null;
  fetchVehicles:   () => Promise<void>;
  fetchEarnings:   () => Promise<void>;
  generateDsoMemo: (dsoName?: string) => Promise<void>;
}

export const useMobilityStore = create<MobilityState>()((set, _get) => ({
  vehicles:   [],
  earnings:   null,
  dsoMemoUrl: null,
  isLoading:  false,
  error:      null,

  fetchVehicles: async () => {
    const token = useStudentStore.getState().authToken;
    if (!token) return;

    set({ isLoading: true });
    try {
      const { vehicles } = await apiGet<{ vehicles: EnrolledVehicle[] }>(
        '/mobility/vehicle',
        token,
      );
      set({ vehicles, isLoading: false });
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
    }
  },

  fetchEarnings: async () => {
    const token = useStudentStore.getState().authToken;
    if (!token) return;

    set({ isLoading: true });
    try {
      const data = await apiGet<EarningsSummary>('/mobility/earnings', token);
      set({ earnings: data, isLoading: false });
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
    }
  },

  generateDsoMemo: async (dsoName) => {
    const token = useStudentStore.getState().authToken;
    if (!token) return;

    set({ isLoading: true, error: null });
    try {
      const { memoUrl } = await apiPost<{ memoUrl: string }>(
        '/mobility/dso-memo/generate',
        { dsoName },
        token,
      );
      set({ dsoMemoUrl: memoUrl, isLoading: false });
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
    }
  },
}));
