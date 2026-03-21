/**
 * services/audit-service/src/chain-anchor.ts
 *
 * External hash anchoring — makes the flight recorder chain
 * tamper-evident even if the primary database is compromised.
 *
 * Mechanism:
 *   Every N entries (default: 50) or on explicit export request:
 *   1. Compute chain tip hash
 *   2. Upload a signed JSON manifest to S3 (versioned bucket)
 *   3. Record S3 ETag + key in audit_chain_anchors table
 *
 * Why S3 with versioning?
 *   S3 object versioning means even if an attacker with AWS credentials
 *   overwrites the object, the previous version is preserved and the ETag
 *   changes — the mismatch is detectable.
 *
 *   For higher assurance, the same manifest can be submitted to AWS QLDB
 *   (ledger database) or a public timestamping service (RFC 3161).
 *   S3-signed is sufficient for civil/regulatory proceedings; QLDB for
 *   criminal-grade evidence chains.
 */

import crypto from 'crypto';
import { queryOne } from '@vecta/database';
import { uploadToS3, getSignedDownloadUrl } from '@vecta/storage';
import { createLogger } from '@vecta/logger';
import { hmacSign } from '@vecta/crypto';

const logger = createLogger('chain-anchor');

// ---------------------------------------------------------------------------
// Anchor manifest type
// ---------------------------------------------------------------------------

export interface AnchorManifest {
  version:        '1.0';
  anchorType:     'S3_SIGNED';
  studentId:      string | null;   // null for global checkpoint
  chainTipHash:   string;
  entryCount:     number;
  taxYear?:       number;
  anchoredAt:     string;          // ISO timestamp
  anchoredBy:     'vecta-audit-service';
  manifestHash:   string;          // HMAC-SHA256 of the whole manifest (excluding this field)
}

// ---------------------------------------------------------------------------
// Create an anchor checkpoint
// ---------------------------------------------------------------------------

export async function anchorChain(
  studentId: string,
  taxYear?: number,
): Promise<{ anchorId: string; s3Key: string; chainTipHash: string; entryCount: number }> {
  // 1. Fetch the current chain tip
  const tip = await queryOne<{
    hash: string;
    count: string;
  }>(
    `SELECT
       (SELECT hash FROM flight_recorder
        WHERE lessor_student_id = $1
        ${taxYear ? 'AND EXTRACT(YEAR FROM ride_started_at) = $2' : ''}
        ORDER BY ride_started_at DESC, id DESC LIMIT 1) AS hash,
       (SELECT COUNT(*)::text FROM flight_recorder
        WHERE lessor_student_id = $1
        ${taxYear ? 'AND EXTRACT(YEAR FROM ride_started_at) = $2' : ''}) AS count`,
    taxYear ? [studentId, taxYear] : [studentId],
  );

  if (!tip?.hash) {
    throw new Error(`No flight recorder entries found for student ${studentId}`);
  }

  const chainTipHash = tip.hash;
  const entryCount   = parseInt(tip.count, 10);

  // 2. Build the manifest
  const anchoredAt = new Date().toISOString();
  const manifestWithoutSig: Omit<AnchorManifest, 'manifestHash'> = {
    version:    '1.0',
    anchorType: 'S3_SIGNED',
    studentId,
    chainTipHash,
    entryCount,
    anchoredAt,
    anchoredBy: 'vecta-audit-service',
    ...(taxYear !== undefined ? { taxYear } : {}),
  };

  const manifestHash = hmacSign(JSON.stringify(manifestWithoutSig));
  const manifest: AnchorManifest = { ...manifestWithoutSig, manifestHash };

  // 3. Upload to S3 versioned compliance bucket
  const s3Key = `anchors/${studentId}/${taxYear ?? 'all'}/${Date.now()}.json`;
  const uploadResult = await uploadToS3(
    'audit',
    s3Key,
    Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
    'application/json',
    {
      studentId,
      chainTipHash: chainTipHash.slice(0, 16),
      entryCount: String(entryCount),
      anchorVersion: '1.0',
    },
  );

  // 4. Record in DB
  const anchorRow = await queryOne<{ id: string }>(
    `INSERT INTO audit_chain_anchors
       (student_id, anchor_type, chain_tip_hash, entry_count, tax_year, s3_key, s3_etag)
     VALUES ($1, 'S3_SIGNED', $2, $3, $4, $5, $6)
     RETURNING id`,
    [studentId, chainTipHash, entryCount, taxYear ?? null, s3Key, uploadResult.eTag ?? null],
  );

  logger.info(
    { studentId, chainTipHash: chainTipHash.slice(0, 16), entryCount, s3Key },
    'Chain anchor created',
  );

  return {
    anchorId:     anchorRow!.id,
    s3Key,
    chainTipHash,
    entryCount,
  };
}

// ---------------------------------------------------------------------------
// Verify a historical anchor — prove it hasn't been tampered with
// ---------------------------------------------------------------------------

export async function verifyAnchor(anchorId: string): Promise<{
  valid:          boolean;
  reason?:        string;
  manifest?:      AnchorManifest;
  currentTipHash: string | null;
  matches:        boolean;
}> {
  const anchor = await queryOne<{
    id: string;
    student_id: string | null;
    chain_tip_hash: string;
    entry_count: number;
    tax_year: number | null;
    s3_key: string;
    s3_etag: string | null;
    anchored_at: string;
  }>(
    `SELECT * FROM audit_chain_anchors WHERE id = $1`,
    [anchorId],
  );

  if (!anchor) {
    return { valid: false, reason: 'ANCHOR_NOT_FOUND', currentTipHash: null, matches: false };
  }

  // Fetch and verify the S3 manifest
  let manifest: AnchorManifest;
  try {
    const signedUrl = await getSignedDownloadUrl('audit', anchor.s3_key, 60);
    const response  = await fetch(signedUrl);
    manifest        = await response.json() as AnchorManifest;
  } catch (err) {
    return { valid: false, reason: 'S3_FETCH_FAILED', currentTipHash: null, matches: false };
  }

  // Verify manifest HMAC
  const { manifestHash, ...manifestWithoutSig } = manifest;
  const expectedHash = hmacSign(JSON.stringify(manifestWithoutSig));
  if (!crypto.timingSafeEqual(Buffer.from(manifestHash), Buffer.from(expectedHash))) {
    return { valid: false, reason: 'MANIFEST_TAMPERED', currentTipHash: null, matches: false };
  }

  // Check if DB-stored tip matches manifest
  if (manifest.chainTipHash !== anchor.chain_tip_hash) {
    return { valid: false, reason: 'DB_S3_MISMATCH', manifest, currentTipHash: null, matches: false };
  }

  // Check current chain tip (has new data been added since anchor?)
  const currentTip = await queryOne<{ hash: string }>(
    `SELECT hash FROM flight_recorder
     WHERE lessor_student_id = $1
     ORDER BY ride_started_at DESC, id DESC LIMIT 1`,
    [anchor.student_id],
  );

  const currentTipHash = currentTip?.hash ?? null;
  const matches        = currentTipHash === anchor.chain_tip_hash;

  return {
    valid:          true,
    manifest,
    currentTipHash,
    // matches = true means no new entries since anchor (static period / tax year complete)
    // matches = false is NORMAL for an active student — it just means new rides logged since
    matches,
  };
}

// ---------------------------------------------------------------------------
// Auto-anchor trigger — call after every USCIS/IRS export
// ---------------------------------------------------------------------------

export async function autoAnchorOnExport(
  studentId: string,
  taxYear: number,
): Promise<string> {
  const result = await anchorChain(studentId, taxYear);
  logger.info(
    { studentId, taxYear, anchorId: result.anchorId },
    'Auto-anchor created on export',
  );
  return result.anchorId;
}
