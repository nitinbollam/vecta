"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.anchorChain = anchorChain;
exports.verifyAnchor = verifyAnchor;
exports.autoAnchorOnExport = autoAnchorOnExport;
const crypto_1 = __importDefault(require("crypto"));
const database_1 = require("@vecta/database");
const storage_1 = require("@vecta/storage");
const logger_1 = require("@vecta/logger");
const crypto_2 = require("@vecta/crypto");
const logger = (0, logger_1.createLogger)('chain-anchor');
// ---------------------------------------------------------------------------
// Create an anchor checkpoint
// ---------------------------------------------------------------------------
async function anchorChain(studentId, taxYear) {
    // 1. Fetch the current chain tip
    const tip = await (0, database_1.queryOne)(`SELECT
       (SELECT hash FROM flight_recorder
        WHERE lessor_student_id = $1
        ${taxYear ? 'AND EXTRACT(YEAR FROM ride_started_at) = $2' : ''}
        ORDER BY ride_started_at DESC, id DESC LIMIT 1) AS hash,
       (SELECT COUNT(*)::text FROM flight_recorder
        WHERE lessor_student_id = $1
        ${taxYear ? 'AND EXTRACT(YEAR FROM ride_started_at) = $2' : ''}) AS count`, taxYear ? [studentId, taxYear] : [studentId]);
    if (!tip?.hash) {
        throw new Error(`No flight recorder entries found for student ${studentId}`);
    }
    const chainTipHash = tip.hash;
    const entryCount = parseInt(tip.count, 10);
    // 2. Build the manifest
    const anchoredAt = new Date().toISOString();
    const manifestWithoutSig = {
        version: '1.0',
        anchorType: 'S3_SIGNED',
        studentId,
        chainTipHash,
        entryCount,
        anchoredAt,
        anchoredBy: 'vecta-audit-service',
        ...(taxYear !== undefined ? { taxYear } : {}),
    };
    const manifestHash = (0, crypto_2.hmacSign)(JSON.stringify(manifestWithoutSig));
    const manifest = { ...manifestWithoutSig, manifestHash };
    // 3. Upload to S3 versioned compliance bucket
    const s3Key = `anchors/${studentId}/${taxYear ?? 'all'}/${Date.now()}.json`;
    const uploadResult = await (0, storage_1.uploadToS3)('audit', s3Key, Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'), 'application/json', {
        studentId,
        chainTipHash: chainTipHash.slice(0, 16),
        entryCount: String(entryCount),
        anchorVersion: '1.0',
    });
    // 4. Record in DB
    const anchorRow = await (0, database_1.queryOne)(`INSERT INTO audit_chain_anchors
       (student_id, anchor_type, chain_tip_hash, entry_count, tax_year, s3_key, s3_etag)
     VALUES ($1, 'S3_SIGNED', $2, $3, $4, $5, $6)
     RETURNING id`, [studentId, chainTipHash, entryCount, taxYear ?? null, s3Key, uploadResult.eTag ?? null]);
    logger.info({ studentId, chainTipHash: chainTipHash.slice(0, 16), entryCount, s3Key }, 'Chain anchor created');
    return {
        anchorId: anchorRow.id,
        s3Key,
        chainTipHash,
        entryCount,
    };
}
// ---------------------------------------------------------------------------
// Verify a historical anchor — prove it hasn't been tampered with
// ---------------------------------------------------------------------------
async function verifyAnchor(anchorId) {
    const anchor = await (0, database_1.queryOne)(`SELECT * FROM audit_chain_anchors WHERE id = $1`, [anchorId]);
    if (!anchor) {
        return { valid: false, reason: 'ANCHOR_NOT_FOUND', currentTipHash: null, matches: false };
    }
    // Fetch and verify the S3 manifest
    let manifest;
    try {
        const signedUrl = await (0, storage_1.getSignedDownloadUrl)('audit', anchor.s3_key, 60);
        const response = await fetch(signedUrl);
        manifest = await response.json();
    }
    catch (err) {
        return { valid: false, reason: 'S3_FETCH_FAILED', currentTipHash: null, matches: false };
    }
    // Verify manifest HMAC
    const { manifestHash, ...manifestWithoutSig } = manifest;
    const expectedHash = (0, crypto_2.hmacSign)(JSON.stringify(manifestWithoutSig));
    if (!crypto_1.default.timingSafeEqual(Buffer.from(manifestHash), Buffer.from(expectedHash))) {
        return { valid: false, reason: 'MANIFEST_TAMPERED', currentTipHash: null, matches: false };
    }
    // Check if DB-stored tip matches manifest
    if (manifest.chainTipHash !== anchor.chain_tip_hash) {
        return { valid: false, reason: 'DB_S3_MISMATCH', manifest, currentTipHash: null, matches: false };
    }
    // Check current chain tip (has new data been added since anchor?)
    const currentTip = await (0, database_1.queryOne)(`SELECT hash FROM flight_recorder
     WHERE lessor_student_id = $1
     ORDER BY ride_started_at DESC, id DESC LIMIT 1`, [anchor.student_id]);
    const currentTipHash = currentTip?.hash ?? null;
    const matches = currentTipHash === anchor.chain_tip_hash;
    return {
        valid: true,
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
async function autoAnchorOnExport(studentId, taxYear) {
    const result = await anchorChain(studentId, taxYear);
    logger.info({ studentId, taxYear, anchorId: result.anchorId }, 'Auto-anchor created on export');
    return result.anchorId;
}
//# sourceMappingURL=chain-anchor.js.map