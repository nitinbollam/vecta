/**
 * Client-side helpers for API payloads shaped like {@link VectaError} from @vecta/types.
 */

import { Alert, Linking } from 'react-native';

export interface VectaApiErrorShape {
  code: string;
  message: string;
  retryable: boolean;
  supportRef: string;
  step?: string;
}

const TITLE_BY_CODE: Record<string, string> = {
  KYC_FAILED: 'Verification Failed',
  KYC_LIVENESS_FAIL: 'Liveness Check Failed',
  BANK_CREATE_FAILED: 'Bank Account',
  ESIM_FAILED: 'eSIM',
  EMAIL_FAILED: 'Email',
  NETWORK_ERROR: 'Connection Error',
  AUTH_EXPIRED: 'Session Expired',
  INSUFFICIENT_FUNDS: 'Insufficient Funds',
};

export function formatVectaErrorTitle(code: string): string {
  return (
    TITLE_BY_CODE[code] ??
    code
      .split('_')
      .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
      .join(' ')
  );
}

export function parseVectaApiError(data: unknown): VectaApiErrorShape | null {
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  if (
    typeof o.code === 'string' &&
    typeof o.message === 'string' &&
    typeof o.retryable === 'boolean' &&
    typeof o.supportRef === 'string'
  ) {
    return {
      code: o.code,
      message: o.message,
      retryable: o.retryable,
      supportRef: o.supportRef,
      ...(typeof o.step === 'string' ? { step: o.step } : {}),
    };
  }
  return null;
}

export function showVectaErrorAlert(
  err: VectaApiErrorShape,
  opts?: { onRetry?: () => void },
): void {
  const title = formatVectaErrorTitle(err.code);
  const supportUrl = `mailto:support@vecta.io?subject=Error%20${encodeURIComponent(err.supportRef)}`;
  const supportBtn = {
    text: 'Contact Support',
    onPress: () => {
      void Linking.openURL(supportUrl);
    },
  };
  if (err.retryable && opts?.onRetry) {
    Alert.alert(title, err.message, [
      { text: 'Try Again', onPress: opts.onRetry },
      supportBtn,
    ]);
  } else {
    Alert.alert(title, err.message, [supportBtn]);
  }
}
