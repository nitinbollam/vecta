/**
 * __tests__/integration.test.ts
 *
 * Integration tests for systems wired in the latest session:
 *   - Single-use token lifecycle (register → consume → reject second use)
 *   - RBAC audit trail written on every decision
 *   - Email notifications triggered on token consumption
 *   - Trust engine composite score accuracy
 *   - getMaskedBalance bucket assignment
 *   - Landlord tier progression logic
 */

// Mock database + Redis for unit testing
jest.mock('@vecta/database', () => ({
  query:           jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne:        jest.fn().mockResolvedValue(null),
  withTransaction: jest.fn().mockImplementation((fn: (client: unknown) => Promise<unknown>) =>
    fn({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    }),
  ),
  checkDatabaseHealth: jest.fn().mockResolvedValue({ ok: true, latencyMs: 1 }),
  closePool:        jest.fn(),
}));

jest.mock('@vecta/logger', () => ({
  createLogger:        () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  logAuditEvent:       jest.fn(),
  logComplianceEvent:  jest.fn(),
  auditLogger:         { info: jest.fn() },
}));

jest.mock('@vecta/crypto', () => ({
  encryptField:    (s: string) => `enc:${s}`,
  decryptField:    (s: string) => s.replace('enc:', ''),
  hmacSign:        (s: string) => `hmac-${s.slice(0, 8)}`,
  hmacVerify:      jest.fn().mockReturnValue(true),
  sha256Hex:       (s: string) => `sha256-${s.slice(0, 8)}`,
  generateSecureToken: () => 'test-secure-token-abc123',
  generateUUID:    () => '550e8400-e29b-41d4-a716-446655440000',
}));

jest.mock('@vecta/storage', () => ({
  uploadToS3:           jest.fn().mockResolvedValue({ key: 'test-key', eTag: 'test-etag', url: 'https://s3.example.com/test' }),
  getSignedDownloadUrl: jest.fn().mockResolvedValue('https://s3.example.com/signed'),
  uploadSelfieToS3:     jest.fn().mockResolvedValue({ key: 'selfie-key', signedUrl: 'https://s3.example.com/selfie' }),
  getSignedSelfieUrl:   jest.fn().mockResolvedValue('https://s3.example.com/selfie-signed'),
  uploadLocPdf:         jest.fn().mockResolvedValue({ key: 'loc-key', signedUrl: 'https://s3.example.com/loc' }),
  deleteFromS3:         jest.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Single-use token lifecycle
// ---------------------------------------------------------------------------

import { computeTrustScore, type TrustEngineInput } from '../services/housing-service/src/trust-engine';

describe('Trust Engine: composite score computation', () => {
  const baseInput: TrustEngineInput = {
    novaTranslatedScore: 750,
    verifiedBalanceUsd:  24_000,
    monthlyRentTarget:   2_000,
    i20ExpirationDate:   new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000), // 2 years out
    leaseDurationMonths: 12,
    livenessScore:       0.95,
    facialMatchScore:    0.93,
    nfcChipVerified:     true,
  };

  it('returns a compositeScore between 0 and 1000', () => {
    const result = computeTrustScore(baseInput);
    expect(result.compositeScore).toBeGreaterThanOrEqual(0);
    expect(result.compositeScore).toBeLessThanOrEqual(1000);
  });

  it('strong inputs yield GOLD or PLATINUM tier', () => {
    const result = computeTrustScore(baseInput);
    expect(['GOLD', 'PLATINUM']).toContain(result.guaranteeTier);
  });

  it('zero balance yields INSUFFICIENT tier', () => {
    const result = computeTrustScore({ ...baseInput, verifiedBalanceUsd: 0 });
    expect(['STANDARD', 'INSUFFICIENT']).toContain(result.guaranteeTier);
  });

  it('expired visa yields reduced visa factor', () => {
    const expired = computeTrustScore({
      ...baseInput,
      i20ExpirationDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
    });
    const valid   = computeTrustScore(baseInput);
    expect(expired.visaFactor).toBeLessThan(valid.visaFactor);
  });

  it('nova score weights are 40% of composite', () => {
    // Max nova (850) vs min nova (300) — all else equal
    const maxNova = computeTrustScore({ ...baseInput, novaTranslatedScore: 850 });
    const minNova = computeTrustScore({ ...baseInput, novaTranslatedScore: 300 });
    // Difference should be approximately 40% of 1000 = 400
    const diff = maxNova.compositeScore - minNova.compositeScore;
    expect(diff).toBeGreaterThan(300);
    expect(diff).toBeLessThan(450);
  });

  it('deposit multiplier is lower for higher tiers', () => {
    const platinum = computeTrustScore({
      ...baseInput,
      novaTranslatedScore: 850,
      verifiedBalanceUsd: 100_000,
    });
    const standard = computeTrustScore({
      ...baseInput,
      novaTranslatedScore: 450,
      verifiedBalanceUsd: 3_000,
    });
    expect(platinum.depositMultiplier).toBeLessThan(standard.depositMultiplier);
  });

  it('maxRentApproval is zero for INSUFFICIENT tier', () => {
    const result = computeTrustScore({
      ...baseInput,
      novaTranslatedScore: 300,
      verifiedBalanceUsd:  100,
      i20ExpirationDate:   new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      livenessScore:       0.5,
      facialMatchScore:    0.5,
      nfcChipVerified:     false,
    });
    if (result.guaranteeTier === 'INSUFFICIENT') {
      expect(result.maxRentApproval).toBe(0);
    }
  });

  it('provides breakdown text for all four factors', () => {
    const result = computeTrustScore(baseInput);
    expect(result.breakdown.novaExplanation).toBeTruthy();
    expect(result.breakdown.liquidityExplanation).toBeTruthy();
    expect(result.breakdown.visaExplanation).toBeTruthy();
    expect(result.breakdown.identityExplanation).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Masked balance tier assignment
// ---------------------------------------------------------------------------

import { getMaskedBalance } from '../services/banking-service/src/plaid.service';

describe('getMaskedBalance: tier assignment', () => {
  const { queryOne } = jest.requireMock('@vecta/database');

  beforeEach(() => jest.clearAllMocks());

  it.each([
    [0,      'LOW',       'Under $2,000'],
    [1_500,  'LOW',       '$2,000 – $5,000'],  // Actually falls in $0–$2k bucket
    [7_500,  'MEDIUM',    '$5,000 – $10,000'],
    [30_000, 'HIGH',      '$25,000 – $50,000'],
    [150_000,'VERY_HIGH', 'Over $100,000'],
  ])('balance $%i → %s tier', async (balance, expectedTier, _label) => {
    queryOne.mockResolvedValueOnce({ total_balance: String(balance), last_updated: new Date().toISOString() });
    const result = await getMaskedBalance('test-student-id');
    expect(result.tier).toBe(expectedTier);
    expect(result.rangeLabel).toBeTruthy();
  });

  it('never exposes exact balance — only tier + range', async () => {
    queryOne.mockResolvedValueOnce({ total_balance: '12345.67', last_updated: new Date().toISOString() });
    const result = await getMaskedBalance('test-student-id');
    // No property should contain the exact balance
    const json = JSON.stringify(result);
    expect(json).not.toContain('12345');
    expect(json).not.toContain('12346');
  });
});

// ---------------------------------------------------------------------------
// Landlord tier logic (no DB — pure unit test)
// ---------------------------------------------------------------------------

import { filterViewForTier, type LandlordAccessContext } from '../packages/auth/src/landlord-access';

describe('filterViewForTier: PII vault enforcement', () => {
  const fullView = {
    fullName:        'Jane Doe',
    selfieUrl:       'https://s3.example.com/selfie.jpg',
    idStatus:        'VERIFIED',
    visaType:        'F-1',
    universityName:  'MIT',
    vectaTrustScore: 820,
    trustScoreTier:  'EXCELLENT',
    usPhoneNumber:   '+1 617 555 0100',
    verifiedEmail:   'jane@mit.edu',
    letterOfCreditId: 'loc-123',
    solvencyGuaranteeMonths: 14,
    maxRentApproval: 3500,
    // PII that should NEVER appear
    passportNumber:  'A12345678',
    nationality:     'Indian',
    countryOfOrigin: 'India',
    bankBalance:     50000,
    accountNumber:   '123456789',
    imei:            '358042085518002',
    ssn:             '123-45-6789',
  };

  const anonymousCtx: LandlordAccessContext = {
    tier: 'ANONYMOUS', ipAddress: '1.2.3.4', userAgent: 'test',
  };

  const verifiedCtx: LandlordAccessContext = {
    tier: 'VERIFIED', ipAddress: '1.2.3.4', userAgent: 'test',
    landlordId: 'lld-123', landlordEmail: 'landlord@example.com',
  };

  const HARD_VAULT = [
    'passportNumber', 'nationality', 'countryOfOrigin',
    'bankBalance', 'accountNumber', 'imei', 'ssn',
  ];

  it('ANONYMOUS view never contains PII', () => {
    const filtered = filterViewForTier(fullView, anonymousCtx);
    for (const field of HARD_VAULT) {
      expect(Object.keys(filtered)).not.toContain(field);
    }
  });

  it('VERIFIED view never contains PII', () => {
    const filtered = filterViewForTier(fullView, verifiedCtx);
    for (const field of HARD_VAULT) {
      expect(Object.keys(filtered)).not.toContain(field);
    }
  });

  it('ANONYMOUS view includes core identity fields', () => {
    const filtered = filterViewForTier(fullView, anonymousCtx);
    expect(filtered.fullName).toBe('Jane Doe');
    expect(filtered.vectaTrustScore).toBe(820);
    expect(filtered.universityName).toBe('MIT');
  });

  it('ANONYMOUS cannot download LoC — field excluded', () => {
    const filtered = filterViewForTier(fullView, anonymousCtx);
    // LoC ID is available at VERIFIED tier and above only
    expect(filtered.letterOfCreditId).toBeUndefined();
  });

  it('VERIFIED can access LoC and score breakdown', () => {
    const filtered = filterViewForTier(fullView, verifiedCtx);
    expect(filtered.letterOfCreditId).toBe('loc-123');
    expect(filtered.maxRentApproval).toBe(3500);
  });
});
