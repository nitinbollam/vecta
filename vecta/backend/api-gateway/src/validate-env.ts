/**
 * Fail-fast validation of critical security-related environment variables.
 * Run immediately after load-env so misconfiguration never starts a half-secure gateway.
 */

const REQUIRED_SECURITY_VARS = [
  "VECTA_JWT_PRIVATE_KEY",
  "VECTA_JWT_PUBLIC_KEY",
  "VECTA_FIELD_ENCRYPTION_KEY",
  "VECTA_HMAC_SECRET",
  "INTERNAL_SERVICE_SECRET",
  "DATABASE_URL",
  "REDIS_URL",
] as const;

const REQUIRED_MIN_LENGTH: Record<string, number> = {
  VECTA_FIELD_ENCRYPTION_KEY: 32,
  INTERNAL_SERVICE_SECRET:    32,
  VECTA_HMAC_SECRET:          32,
};

function isBadValue(val: string | undefined): boolean {
  if (!val || val.trim() === "") return true;
  const lower = val.toLowerCase();
  if (lower.includes("placeholder") || lower.includes("replace")) return true;
  return false;
}

export function validateSecurityEnv(): void {
  const missing: string[] = [];
  const tooShort: string[] = [];

  for (const key of REQUIRED_SECURITY_VARS) {
    const val = process.env[key];
    if (isBadValue(val)) {
      missing.push(key);
      continue;
    }
    const minLen = REQUIRED_MIN_LENGTH[key];
    if (minLen && val!.length < minLen) {
      tooShort.push(`${key} (min ${minLen} chars, got ${val!.length})`);
    }
  }

  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.error("STARTUP FAILED — Missing required security environment variables:");
    missing.forEach((k) => {
      // eslint-disable-next-line no-console
      console.error(`  ✗ ${k}`);
    });
    process.exit(1);
  }

  if (tooShort.length > 0) {
    // eslint-disable-next-line no-console
    console.error("STARTUP FAILED — Security environment variables are too short:");
    tooShort.forEach((k) => {
      // eslint-disable-next-line no-console
      console.error(`  ✗ ${k}`);
    });
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log("✓ Security environment variables validated");
}
