/**
 * packages/auth/src/key-manager.ts
 *
 * Key Management System — versioned Ed25519 key rotation.
 *
 * Gap being closed:
 *   The original crypto-signer.ts derives one key from INTERNAL_SERVICE_SECRET.
 *   If the secret rotates, every certificate issued with the old key becomes
 *   unverifiable. The system collapses silently.
 *
 * This module provides:
 *
 * 1. Versioned key derivation
 *    Each key version has an ID (e.g., "v1", "v2").
 *    Derivation: HKDF-SHA256(SECRET, salt="vecta-key-{version}")
 *    All active key versions are retained for verification.
 *    Only the CURRENT version is used for signing.
 *
 * 2. Public key registry endpoint
 *    GET /well-known/vecta-keys.json returns all active public keys.
 *    Third parties cache this to verify certificates offline.
 *    Format mirrors OIDC JWKS — familiar to security teams.
 *
 * 3. Rotation procedure
 *    1. Set KEY_VERSION=v2 (or increment)
 *    2. Set INTERNAL_SERVICE_SECRET_V2=... in environment
 *    3. Deploy — new certs use v2, old certs still verify with v1
 *    4. After cert expiry window (30 days): deprecate v1
 *    5. Remove V1 from env — registry stops advertising it
 *
 * 4. Certificate includes keyId
 *    Every certificate now includes the keyId used to sign it.
 *    Verifier looks up the public key by keyId, not by "current key."
 *    This is the critical missing link for portability.
 *
 * Design mirrors: OIDC Key Discovery (RFC 7517 JWKS)
 */

import crypto from 'crypto';
import { createLogger } from '@vecta/logger';

const logger = createLogger('key-manager');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KeyVersion {
  keyId:        string;       // e.g. "vecta-cert-v1"
  algorithm:    'Ed25519';
  publicKeyHex: string;       // SPKI DER hex — for embedding in certificates
  publicKeyPem: string;       // PEM — for JWKS and human-readable use
  notBefore:    string;       // ISO 8601 — when this key became active
  notAfter?:    string;       // ISO 8601 — when this key was retired (undefined = still active)
  status:       'ACTIVE' | 'RETIRED';
}

export interface JWK {
  kty:  'OKP';
  crv:  'Ed25519';
  x:    string;    // base64url-encoded public key (32 bytes)
  kid:  string;    // key ID
  use:  'sig';
  alg:  'EdDSA';
}

export interface JWKS {
  keys:         JWK[];
  _metadata: {
    issuer:       string;
    jwks_uri:     string;
    last_updated: string;
    active_kid:   string;
  };
}

// ---------------------------------------------------------------------------
// Key derivation (deterministic per version + secret)
// ---------------------------------------------------------------------------

function deriveKeyForVersion(version: string): { privateKey: crypto.KeyObject; publicKey: crypto.KeyObject } {
  // Try versioned secret first (e.g., INTERNAL_SERVICE_SECRET_V2)
  const versionedEnvKey = `INTERNAL_SERVICE_SECRET_${version.toUpperCase()}`;
  const secret = process.env[versionedEnvKey] ?? process.env.INTERNAL_SERVICE_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(`[key-manager] No secret found for key version "${version}". ` +
      `Set ${versionedEnvKey} or INTERNAL_SERVICE_SECRET.`);
  }

  // HKDF: deterministic 32-byte Ed25519 seed per version
  const seed = crypto.hkdfSync(
    'sha256',
    Buffer.from(secret, 'utf8'),
    Buffer.from(`vecta-key-${version}`, 'utf8'),   // version-specific salt
    Buffer.from('ed25519-signing-key', 'utf8'),
    32,
  ) as unknown as Buffer;

  const privateKey = crypto.createPrivateKey({
    key:    Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      seed,
    ]),
    format: 'der',
    type:   'pkcs8',
  });

  return { privateKey, publicKey: crypto.createPublicKey(privateKey) };
}

// ---------------------------------------------------------------------------
// Key registry — singleton, loads all configured versions
// ---------------------------------------------------------------------------

class KeyRegistry {
  private readonly keys: Map<string, {
    privateKey: crypto.KeyObject;
    meta:       KeyVersion;
  }> = new Map();

  private currentKeyId: string = '';

  constructor() {
    this.loadKeys();
  }

  private loadKeys(): void {
    // Discover configured key versions from environment
    // Format: KEY_VERSIONS=v1,v2  (comma-separated, latest last)
    const versions = (process.env.KEY_VERSIONS ?? 'v1').split(',').map((v) => v.trim());

    for (const version of versions) {
      try {
        const keyId = `vecta-cert-${version}`;
        const { privateKey, publicKey } = deriveKeyForVersion(version);

        const pubDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
        const pubPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;

        const notAfterEnv = process.env[`KEY_NOT_AFTER_${version.toUpperCase()}`];
        const meta: KeyVersion = {
          keyId,
          algorithm:    'Ed25519',
          publicKeyHex: pubDer.toString('hex'),
          publicKeyPem: pubPem,
          notBefore:    process.env[`KEY_NOT_BEFORE_${version.toUpperCase()}`]
            ?? new Date(0).toISOString(),
          status:       notAfterEnv ? 'RETIRED' : 'ACTIVE',
        };
        if (notAfterEnv) meta.notAfter = notAfterEnv;

        this.keys.set(keyId, {
          privateKey,
          meta,
        });

        logger.info({ keyId, status: this.keys.get(keyId)!.meta.status }, 'Key version loaded');
      } catch (err) {
        // If a retired key's secret has been removed, log a warning but continue
        logger.warn({ version, err: (err as Error).message }, 'Could not load key version');
      }
    }

    // Current key = the last ACTIVE version
    const activeKeys = [...this.keys.entries()]
      .filter(([, v]) => v.meta.status === 'ACTIVE');

    if (activeKeys.length === 0) {
      throw new Error('[key-manager] No active signing keys found. Check KEY_VERSIONS env var.');
    }

    this.currentKeyId = activeKeys[activeKeys.length - 1]![0];
    logger.info({ currentKeyId: this.currentKeyId }, 'Active signing key set');
  }

  getCurrentKeyId(): string { return this.currentKeyId; }

  getSigningKey(): { privateKey: crypto.KeyObject; keyId: string } {
    const entry = this.keys.get(this.currentKeyId);
    if (!entry) throw new Error(`[key-manager] Current key ${this.currentKeyId} not found`);
    return { privateKey: entry.privateKey, keyId: this.currentKeyId };
  }

  getPublicKey(keyId: string): KeyVersion | null {
    return this.keys.get(keyId)?.meta ?? null;
  }

  getAllPublicKeys(): KeyVersion[] {
    return [...this.keys.values()].map((v) => v.meta);
  }

  getActivePublicKeys(): KeyVersion[] {
    return this.getAllPublicKeys().filter((k) => k.status === 'ACTIVE');
  }
}

let _registry: KeyRegistry | null = null;

export function getKeyRegistry(): KeyRegistry {
  if (!_registry) _registry = new KeyRegistry();
  return _registry;
}

// ---------------------------------------------------------------------------
// JWKS generation — for /.well-known/vecta-keys.json
// ---------------------------------------------------------------------------

function publicKeyHexToJWK(keyHex: string, keyId: string): JWK {
  // Ed25519 SPKI DER has a 12-byte header; the 32-byte key material follows
  const der       = Buffer.from(keyHex, 'hex');
  const keyBytes  = der.slice(12, 44);  // bytes 12–43 = raw 32-byte public key
  const x         = keyBytes.toString('base64url');

  return { kty: 'OKP', crv: 'Ed25519', x, kid: keyId, use: 'sig', alg: 'EdDSA' };
}

export function buildJWKS(): JWKS {
  const registry   = getKeyRegistry();
  const allKeys    = registry.getAllPublicKeys();

  return {
    keys: allKeys.map((k) => publicKeyHexToJWK(k.publicKeyHex, k.keyId)),
    _metadata: {
      issuer:       'Vecta Financial Services LLC',
      jwks_uri:     `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://verify.vecta.io'}/.well-known/vecta-keys.json`,
      last_updated: new Date().toISOString(),
      active_kid:   registry.getCurrentKeyId(),
    },
  };
}

// ---------------------------------------------------------------------------
// Sign with current key (replaces the old signCertificate signing logic)
// ---------------------------------------------------------------------------

export function signWithCurrentKey(hashHex: string): {
  signature:    string;
  keyId:        string;
  publicKeyHex: string;
} {
  const registry  = getKeyRegistry();
  const { privateKey, keyId } = registry.getSigningKey();
  const pubMeta   = registry.getPublicKey(keyId)!;

  const sig = crypto.sign(null, Buffer.from(hashHex, 'hex'), privateKey);

  return {
    signature:    sig.toString('hex'),
    keyId,
    publicKeyHex: pubMeta.publicKeyHex,
  };
}

// ---------------------------------------------------------------------------
// Verify with the key that signed the certificate (by keyId)
// ---------------------------------------------------------------------------

export function verifyWithKeyId(
  hashHex:      string,
  signatureHex: string,
  keyId:        string,
): { valid: boolean; reason?: string } {
  const registry = getKeyRegistry();
  const keyMeta  = registry.getPublicKey(keyId);

  if (!keyMeta) {
    return { valid: false, reason: `KEY_NOT_FOUND: keyId "${keyId}" not in registry` };
  }

  try {
    const pub = crypto.createPublicKey({
      key:    Buffer.from(keyMeta.publicKeyHex, 'hex'),
      format: 'der',
      type:   'spki',
    });

    const valid = crypto.verify(
      null,
      Buffer.from(hashHex, 'hex'),
      pub,
      Buffer.from(signatureHex, 'hex'),
    );

    return valid
      ? { valid: true }
      : { valid: false, reason: 'SIGNATURE_INVALID' };
  } catch {
    return { valid: false, reason: 'SIGNATURE_INVALID' };
  }
}
