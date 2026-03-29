/**
 * Standard API error payload for clients (student app, landlord portal).
 */

export interface VectaError {
  code: string;
  message: string;
  retryable: boolean;
  supportRef: string;
  step?: string;
}

export function createError(
  code: string,
  message: string,
  retryable: boolean,
  step?: string,
): VectaError {
  return {
    code,
    message,
    retryable,
    supportRef: Math.random().toString(36).slice(2, 8).toUpperCase(),
    ...(step !== undefined ? { step } : {}),
  };
}

/** Same message/retryable/step as ERRORS[key], new supportRef for each response. */
export function freshError(key: keyof typeof ERRORS): VectaError {
  const t = ERRORS[key];
  return {
    ...t,
    supportRef: Math.random().toString(36).slice(2, 8).toUpperCase(),
  };
}

export const ERRORS = {
  KYC_FAILED: createError(
    "KYC_FAILED",
    "Identity verification failed. Please try again.",
    true,
    "KYC_VERIFIED",
  ),
  KYC_LIVENESS_FAIL: createError(
    "KYC_LIVENESS_FAIL",
    "Liveness check failed. Please ensure good lighting and try again.",
    true,
    "KYC_INITIATED",
  ),
  BANK_CREATE_FAILED: createError(
    "BANK_CREATE_FAILED",
    "Could not create your US bank account. We are retrying.",
    true,
    "BANK_ACCOUNT_CREATED",
  ),
  ESIM_FAILED: createError(
    "ESIM_FAILED",
    "eSIM activation failed. You can retry from the eSIM screen.",
    true,
    "ESIM_PROVISIONED",
  ),
  EMAIL_FAILED: createError(
    "EMAIL_FAILED",
    "Could not send sign-in email. Check your email address and try again.",
    true,
  ),
  NETWORK_ERROR: createError(
    "NETWORK_ERROR",
    "Connection error. Please check your internet and try again.",
    true,
  ),
  AUTH_EXPIRED: createError(
    "AUTH_EXPIRED",
    "Your session has expired. Please sign in again.",
    false,
  ),
  INSUFFICIENT_FUNDS: createError(
    "INSUFFICIENT_FUNDS",
    "Insufficient balance for this action.",
    false,
  ),
} as const;
