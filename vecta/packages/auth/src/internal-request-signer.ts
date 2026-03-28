/**
 * HMAC signing for internal service-to-service requests (API gateway → workers).
 */
import crypto from "crypto";

const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET ?? "";

export function signInternalRequest(
  method: string,
  path: string,
  bodyJson: string,
): {
  "x-internal-signature": string;
  "x-internal-timestamp": string;
  "x-internal-service": string;
} {
  const timestamp = Date.now().toString();
  const payload = `${method.toUpperCase()}\n${path}\n${timestamp}\n${bodyJson}`;
  const signature = crypto
    .createHmac("sha256", INTERNAL_SECRET)
    .update(payload)
    .digest("hex");

  return {
    "x-internal-signature": signature,
    "x-internal-timestamp": timestamp,
    "x-internal-service": "api-gateway",
  };
}

function headerVal(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0];
  return v;
}

export function verifyInternalRequest(
  method: string,
  path: string,
  bodyJson: string,
  headers: Record<string, string | string[] | undefined>,
): boolean {
  if (!INTERNAL_SECRET || INTERNAL_SECRET.length < 32) return false;

  const sigStr = headerVal(headers, "x-internal-signature");
  const tsStr = headerVal(headers, "x-internal-timestamp");

  if (!sigStr || !tsStr) return false;

  const age = Date.now() - parseInt(tsStr, 10);
  if (Number.isNaN(age) || age > 5 * 60 * 1000 || age < -60 * 1000) return false;

  const payload = `${method.toUpperCase()}\n${path}\n${tsStr}\n${bodyJson}`;
  const expectedSig = crypto
    .createHmac("sha256", INTERNAL_SECRET)
    .update(payload)
    .digest("hex");

  let expBuf: Buffer;
  let sigBuf: Buffer;
  try {
    expBuf = Buffer.from(expectedSig, "hex");
    sigBuf = Buffer.from(sigStr, "hex");
  } catch {
    return false;
  }
  if (expBuf.length !== sigBuf.length) return false;

  return crypto.timingSafeEqual(expBuf, sigBuf);
}
