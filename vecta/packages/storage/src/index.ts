/**
 * @vecta/storage — S3-compatible object storage wrapper.
 *
 * Bucket layout:
 *   vecta-identity/selfies/{studentId}/{timestamp}.jpg      — Didit liveness selfies
 *   vecta-identity/documents/{studentId}/{docType}.pdf      — KYC documents (Unit)
 *   vecta-housing/loc/{studentId}/{locId}.pdf               — Letters of Credit
 *   vecta-compliance/audit/{studentId}/{exportId}.json      — Flight Recorder exports
 *
 * All objects are:
 *   - Server-side encrypted (SSE-S3 / SSE-KMS)
 *   - Private by default — never public
 *   - Accessed only via short-lived pre-signed URLs (15 min max for PII)
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createLogger } from '@vecta/logger';

const logger = createLogger('storage-service');

// ---------------------------------------------------------------------------
// Client bootstrap
// ---------------------------------------------------------------------------

const s3 = new S3Client({
  region: process.env.AWS_REGION ?? 'us-east-1',
  ...(process.env.S3_ENDPOINT && {
    endpoint: process.env.S3_ENDPOINT, // LocalStack / MinIO in dev
    forcePathStyle: true,
  }),
});

const IDENTITY_BUCKET = process.env.S3_IDENTITY_BUCKET ?? 'vecta-identity';
const HOUSING_BUCKET  = process.env.S3_HOUSING_BUCKET  ?? 'vecta-housing';
const AUDIT_BUCKET    = process.env.S3_AUDIT_BUCKET    ?? 'vecta-compliance';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StorageBucket = 'identity' | 'housing' | 'audit';

interface UploadResult {
  bucket: string;
  key: string;
  eTag: string | undefined;
  url: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveBucket(bucket: StorageBucket): string {
  switch (bucket) {
    case 'identity': return IDENTITY_BUCKET;
    case 'housing':  return HOUSING_BUCKET;
    case 'audit':    return AUDIT_BUCKET;
  }
}

// ---------------------------------------------------------------------------
// Core operations
// ---------------------------------------------------------------------------

/**
 * Upload a Buffer to S3. Returns the key and a 15-minute pre-signed GET URL.
 */
export async function uploadToS3(
  bucket: StorageBucket,
  key: string,
  body: Buffer,
  contentType: string,
  metadata?: Record<string, string>,
): Promise<UploadResult> {
  const bucketName = resolveBucket(bucket);

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: body,
    ContentType: contentType,
    ServerSideEncryption: 'aws:kms',
    Metadata: metadata,
    // Enforce private ACL — no public read ever
    ACL: 'private',
  });

  const response = await s3.send(command);

  logger.info({ bucket: bucketName, key, contentType }, 'S3 upload complete');

  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: bucketName, Key: key }),
    { expiresIn: 900 }, // 15 minutes
  );

  return { bucket: bucketName, key, eTag: response.ETag, url };
}

/**
 * Generate a short-lived pre-signed GET URL for an existing object.
 * Default TTL: 15 min for PII objects, 60 min for LoC PDFs.
 */
export async function getSignedDownloadUrl(
  bucket: StorageBucket,
  key: string,
  expiresInSeconds = 900,
): Promise<string> {
  const bucketName = resolveBucket(bucket);

  // Verify object exists before signing
  await s3.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));

  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: bucketName, Key: key }),
    { expiresIn: expiresInSeconds },
  );
}

/**
 * Delete an object from S3. Used during data-erasure requests (GDPR/CCPA).
 */
export async function deleteFromS3(
  bucket: StorageBucket,
  key: string,
): Promise<void> {
  const bucketName = resolveBucket(bucket);
  await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
  logger.info({ bucket: bucketName, key }, 'S3 object deleted');
}

// ---------------------------------------------------------------------------
// Domain-specific helpers
// ---------------------------------------------------------------------------

/**
 * Upload a student's liveness selfie from Didit.
 * Returns a 15-min signed URL for immediate display on the landlord portal.
 */
export async function uploadSelfieToS3(
  studentId: string,
  imageBuffer: Buffer,
  mimeType: 'image/jpeg' | 'image/png' = 'image/jpeg',
): Promise<{ key: string; signedUrl: string }> {
  const ext = mimeType === 'image/jpeg' ? 'jpg' : 'png';
  const key = `selfies/${studentId}/${Date.now()}.${ext}`;

  const result = await uploadToS3('identity', key, imageBuffer, mimeType, {
    studentId,
    uploadedAt: new Date().toISOString(),
    purpose: 'liveness-check',
  });

  return { key: result.key, signedUrl: result.url };
}

/**
 * Retrieve a fresh 15-min signed URL for an existing selfie.
 * Called each time the landlord portal loads — URLs are never persisted.
 */
export async function getSignedSelfieUrl(selfieKey: string): Promise<string> {
  return getSignedDownloadUrl('identity', selfieKey, 900);
}

/**
 * Upload a Letter of Credit PDF.
 * Returns a 60-min signed URL for landlord download.
 */
export async function uploadLocPdf(
  studentId: string,
  locId: string,
  pdfBuffer: Buffer,
): Promise<{ key: string; signedUrl: string }> {
  const key = `loc/${studentId}/${locId}.pdf`;

  const result = await uploadToS3('housing', key, pdfBuffer, 'application/pdf', {
    studentId,
    locId,
    generatedAt: new Date().toISOString(),
    purpose: 'letter-of-credit',
  });

  // LoC PDFs get a 1-hour window (landlord may print / forward to their agent)
  const signedUrl = await getSignedDownloadUrl('housing', key, 3600);

  return { key: result.key, signedUrl };
}

/**
 * Upload a KYC document for Unit.co submission.
 */
export async function uploadKycDocument(
  studentId: string,
  docType: string,
  pdfBuffer: Buffer,
): Promise<{ key: string }> {
  const key = `documents/${studentId}/${docType}-${Date.now()}.pdf`;
  const result = await uploadToS3('identity', key, pdfBuffer, 'application/pdf', {
    studentId,
    docType,
    purpose: 'kyc',
  });
  return { key: result.key };
}

/**
 * Upload a Flight Recorder audit chain export for USCIS/IRS.
 */
export async function uploadAuditExport(
  studentId: string,
  exportId: string,
  jsonBuffer: Buffer,
): Promise<{ key: string; signedUrl: string }> {
  const key = `audit/${studentId}/${exportId}.json`;
  const result = await uploadToS3('audit', key, jsonBuffer, 'application/json', {
    studentId,
    exportId,
    purpose: 'uscis-irs-audit',
  });
  // Audit exports: 24h URL for DSO/attorney access
  const signedUrl = await getSignedDownloadUrl('audit', key, 86400);
  return { key: result.key, signedUrl };
}
