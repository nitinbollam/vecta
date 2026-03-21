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
export interface AnchorManifest {
    version: '1.0';
    anchorType: 'S3_SIGNED';
    studentId: string | null;
    chainTipHash: string;
    entryCount: number;
    taxYear?: number;
    anchoredAt: string;
    anchoredBy: 'vecta-audit-service';
    manifestHash: string;
}
export declare function anchorChain(studentId: string, taxYear?: number): Promise<{
    anchorId: string;
    s3Key: string;
    chainTipHash: string;
    entryCount: number;
}>;
export declare function verifyAnchor(anchorId: string): Promise<{
    valid: boolean;
    reason?: string;
    manifest?: AnchorManifest;
    currentTipHash: string | null;
    matches: boolean;
}>;
export declare function autoAnchorOnExport(studentId: string, taxYear: number): Promise<string>;
//# sourceMappingURL=chain-anchor.d.ts.map