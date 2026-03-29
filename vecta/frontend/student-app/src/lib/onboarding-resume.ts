import { router, type Href } from 'expo-router';
import { API_V1_BASE } from '../config/api';

export interface OnboardingStateResponse {
  step: string;
  status: string;
  error: string | null;
}

export async function fetchOnboardingState(authToken: string): Promise<OnboardingStateResponse | null> {
  const res = await fetch(`${API_V1_BASE}/identity/onboarding/state`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!res.ok) return null;
  return res.json() as Promise<OnboardingStateResponse>;
}

function failurePathForStep(step: string): string {
  switch (step) {
    case 'BANK_ACCOUNT_CREATED':
      return '/onboarding/banking';
    case 'ESIM_PROVISIONED':
      return '/onboarding/esim';
    case 'KYC_VERIFIED':
      return '/onboarding/banking';
    case 'KYC_INITIATED':
    case 'EMAIL_VERIFIED':
    default:
      return '/onboarding/passport-scan';
  }
}

export function onboardingResumeHref(state: OnboardingStateResponse): Href {
  if (state.status === 'COMPLETE' || state.step === 'ONBOARDING_COMPLETE') {
    return '/(tabs)';
  }
  if (state.status === 'FAILED') {
    const base = failurePathForStep(state.step);
    const q = state.error ? `?onboardingError=${encodeURIComponent(state.error)}` : '';
    return `${base}${q}` as Href;
  }
  switch (state.step) {
    case 'EMAIL_VERIFIED':
    case 'KYC_INITIATED':
      return '/onboarding/passport-scan';
    case 'KYC_VERIFIED':
      return '/onboarding/banking';
    case 'BANK_ACCOUNT_CREATED':
      return '/onboarding/esim';
    case 'ESIM_PROVISIONED':
      return '/(tabs)';
    default:
      return '/onboarding';
  }
}

/** After sign-in or cold start with a stored token, align navigation with server onboarding state. */
export async function replaceWithOnboardingResume(authToken: string): Promise<void> {
  const state = await fetchOnboardingState(authToken);
  if (!state) return;
  router.replace(onboardingResumeHref(state));
}
