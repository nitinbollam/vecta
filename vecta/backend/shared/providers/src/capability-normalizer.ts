/**
 * packages/providers/src/capability-normalizer.ts
 *
 * Capability Normalization Layer.
 *
 * Problem: Unit.co and Stripe Treasury both implement BankingProvider,
 * but they have different behavioral characteristics:
 *
 *   Unit.co:
 *     - KYC via Plaid + passport (no SSN path)
 *     - Webhooks: customer.updated with status field
 *     - DDA with routing/account number immediately
 *     - Debit card issuance: 5-7 days
 *
 *   Stripe Treasury:
 *     - KYC via Stripe Identity (async, separate flow)
 *     - Webhooks: identity.verification_session.* events
 *     - Financial account, routing number after KYC only
 *     - Card: Stripe Issuing (different product, different approval)
 *
 * If we failover from Unit to Stripe:
 *   - A student's KYC "approved" status in our DB may not translate correctly
 *   - A routing number may not yet be available
 *   - Webhook event names are completely different
 *
 * This layer:
 *   1. Declares what capabilities a specific provider instance actually supports
 *   2. Detects behavioral inconsistencies at failover time
 *   3. Emits CAPABILITY_MISMATCH compliance events instead of silently degrading
 *   4. Prevents operations that would produce corrupted state
 */

import { createLogger, logComplianceEvent } from '@vecta/logger';
import type { BankingProvider, IdentityProvider, BankDataProvider } from './interfaces';

const logger = createLogger('capability-normalizer');

// ---------------------------------------------------------------------------
// Capability declarations
// ---------------------------------------------------------------------------

/** Precise behavioral capabilities — not just "implements interface" */
export interface BankingCapabilities {
  // Account provisioning
  provisionWithoutSSN:        boolean;
  routingNumberImmediate:     boolean;   // false = only after KYC
  cardIssuanceIncluded:       boolean;   // false = separate product
  cardDeliveryDays:           number;

  // KYC
  kycViaPassport:             boolean;
  kycSyncStatus:              boolean;   // true = KYC status in provision response
  kycWebhookEvent:            string;    // exact event name for KYC changes
  kycApprovedWebhookStatus:   string;    // value that means "APPROVED"

  // Limits
  maxDailyTransferUsd:        number;
  maxBalanceUsd:              number;
  internationalWireSupport:   boolean;

  // Compliance
  bsaReportingBuiltIn:        boolean;   // true = vendor handles CTR/SAR filing
  fdicInsured:                boolean;
  fdicLimit:                  number;
}

export interface IdentityCapabilities {
  nfcPassportSupport:         boolean;
  livenessCheckIncluded:      boolean;
  facialMatchIncluded:        boolean;
  webhookEvent:               string;
  approvedWebhookStatus:      string;
  sdkType:                    'native_sdk' | 'web_redirect' | 'iframe';
  documentTypes:              string[];
}

export interface BankDataCapabilities {
  internationalBankSupport:   boolean;
  assetReportAvailable:       boolean;
  assetReportPollRequired:    boolean;  // true = must poll; false = webhook only
  webhookReadyEvent:          string;
  transactionHistoryDays:     number;
}

// ---------------------------------------------------------------------------
// Provider capability registry — ground truth for each vendor
// ---------------------------------------------------------------------------

export const BANKING_CAPABILITIES: Record<string, BankingCapabilities> = {
  // ── Vertical Fortress: VectaLedger (in-house, best capabilities) ──────────
  'vecta-ledger': {
    provisionWithoutSSN:      true,
    routingNumberImmediate:   true,    // generated immediately, no KYC wait
    cardIssuanceIncluded:     true,
    cardDeliveryDays:         0,       // virtual card, instant
    kycViaPassport:           true,    // NFC ICAO 9303 verified by VectaID
    kycSyncStatus:            true,    // sync — result in provisioning response
    kycWebhookEvent:          'LEDGER_ACCOUNT_CREATED',
    kycApprovedWebhookStatus: 'ACTIVE',
    maxDailyTransferUsd:      10_000,
    maxBalanceUsd:            500_000,
    internationalWireSupport: false,   // ACH only in v1; SWIFT in v2
    bsaReportingBuiltIn:      false,   // ⚠️  file via Column Bank partnership
    fdicInsured:              true,    // via Column Bank sponsorship
    fdicLimit:                250_000,
  },
  'Unit.co': {
    provisionWithoutSSN:      true,
    routingNumberImmediate:   true,
    cardIssuanceIncluded:     true,
    cardDeliveryDays:         7,
    kycViaPassport:           true,
    kycSyncStatus:            false,    // KYC is async — comes via webhook
    kycWebhookEvent:          'customer.updated',
    kycApprovedWebhookStatus: 'Active',
    maxDailyTransferUsd:      10_000,
    maxBalanceUsd:            250_000,
    internationalWireSupport: false,
    bsaReportingBuiltIn:      true,
    fdicInsured:              true,
    fdicLimit:                250_000,
  },
  'Stripe Treasury': {
    provisionWithoutSSN:      true,
    routingNumberImmediate:   false,    // ⚠️ Only after KYC — significant difference
    cardIssuanceIncluded:     false,    // ⚠️ Requires Stripe Issuing (separate approval)
    cardDeliveryDays:         10,
    kycViaPassport:           true,
    kycSyncStatus:            false,
    kycWebhookEvent:          'identity.verification_session.verified',
    kycApprovedWebhookStatus: 'verified',
    maxDailyTransferUsd:      25_000,
    maxBalanceUsd:            1_000_000,
    internationalWireSupport: true,
    bsaReportingBuiltIn:      false,   // ⚠️ Must file CTR/SAR independently
    fdicInsured:              true,
    fdicLimit:                250_000,
  },
};

export const IDENTITY_CAPABILITIES: Record<string, IdentityCapabilities> = {
  // ── Vertical Fortress: VectaID (in-house, ICAO 9303 NFC, no external API) ──
  'vecta-id': {
    nfcPassportSupport:    true,
    livenessCheckIncluded: true,
    facialMatchIncluded:   true,
    webhookEvent:          'VECTA_ID_VERIFY_ATTEMPT',   // internal audit event
    approvedWebhookStatus: 'APPROVED',
    sdkType:               'native_sdk',
    documentTypes:         ['passport'],
    // Extended capabilities (not on IdentityCapabilities interface — documented here):
    // csca_verification:         true,   // verifies gov cert chain via CSCA registry
    // liveness_challenge_response: true, // blink/smile/turn challenges, not static
    // active_authentication:     true,   // proves chip is not cloned
    // passive_authentication:    true,   // hash chain verification
    // offline_capable:           true,   // NFC read works without internet
  },
  'Didit': {
    nfcPassportSupport:    true,
    livenessCheckIncluded: true,
    facialMatchIncluded:   true,
    webhookEvent:          'verification.completed',
    approvedWebhookStatus: 'approved',
    sdkType:               'native_sdk',
    documentTypes:         ['passport', 'id_card', 'drivers_license'],
  },
  'Persona': {
    nfcPassportSupport:    false,        // ⚠️ No NFC — uses OCR + liveness only
    livenessCheckIncluded: true,
    facialMatchIncluded:   true,
    webhookEvent:          'inquiry.completed',
    approvedWebhookStatus: 'completed',
    sdkType:               'web_redirect',
    documentTypes:         ['passport', 'drivers_license'],
  },
};

export const BANK_DATA_CAPABILITIES: Record<string, BankDataCapabilities> = {
  // ── Vertical Fortress: VectaConnect (Open Banking, multi-country) ──────────
  'vecta-connect': {
    internationalBankSupport: true,    // India AA, UK OB, EU PSD2, US OAuth
    assetReportAvailable:     true,
    assetReportPollRequired:  false,   // real-time via AA framework
    webhookReadyEvent:        'BANK_CONNECTED',
    transactionHistoryDays:   90,
    // Extended capabilities:
    // open_banking_direct:    true,  // AA/OB/PSD2, not screen scraping
    // aa_framework:           true,  // India's RBI Account Aggregator
    // free_tier_india:        true,  // $0/connection for Indian banks
  },
  'Plaid': {
    internationalBankSupport: false,     // ⚠️ US/Canada/UK only for Assets
    assetReportAvailable:     true,
    assetReportPollRequired:  true,      // must poll; webhook is unreliable
    webhookReadyEvent:        'ASSET_REPORT_READY',
    transactionHistoryDays:   730,
  },
  'MX': {
    internationalBankSupport: true,
    assetReportAvailable:     true,
    assetReportPollRequired:  false,
    webhookReadyEvent:        'account_created',
    transactionHistoryDays:   365,
  },
};

// ---------------------------------------------------------------------------
// Capability delta — what changes when you failover
// ---------------------------------------------------------------------------

export interface CapabilityDelta {
  lostCapabilities:   string[];
  gainedCapabilities: string[];
  criticalLosses:     string[];   // subset of lost that could cause compliance issues
  safeToFailover:     boolean;
  requiredAdaptations: string[];  // what the application must do differently
}

export function computeCapabilityDelta(
  primaryName: string,
  fallbackName: string,
  providerType: 'banking' | 'identity' | 'bankData',
): CapabilityDelta {
  const registry = {
    banking:  BANKING_CAPABILITIES,
    identity: IDENTITY_CAPABILITIES,
    bankData: BANK_DATA_CAPABILITIES,
  }[providerType] as unknown as Record<string, Record<string, unknown>>;

  const primary  = registry[primaryName];
  const fallback = registry[fallbackName];

  if (!primary || !fallback) {
    return {
      lostCapabilities:    ['ALL — provider not in registry'],
      gainedCapabilities:  [],
      criticalLosses:      ['ALL'],
      safeToFailover:      false,
      requiredAdaptations: ['Register provider capabilities before enabling failover'],
    };
  }

  const lost: string[]    = [];
  const gained: string[]  = [];
  const critical: string[] = [];
  const adaptations: string[] = [];

  for (const [key, primaryVal] of Object.entries(primary)) {
    const fallbackVal = fallback[key];
    if (primaryVal === true  && fallbackVal === false) {
      lost.push(key);
    }
    if (primaryVal === false && fallbackVal === true) {
      gained.push(key);
    }
    if (typeof primaryVal === 'number' && typeof fallbackVal === 'number') {
      if (fallbackVal < primaryVal) {
        lost.push(`${key}: ${primaryVal} → ${fallbackVal}`);
      }
    }
  }

  // Classify critical losses by provider type
  const criticalKeys: Record<string, string[]> = {
    banking:  ['provisionWithoutSSN', 'kycViaPassport', 'bsaReportingBuiltIn', 'fdicInsured'],
    identity: ['nfcPassportSupport',  'livenessCheckIncluded'],
    bankData: ['assetReportAvailable'],
  };

  for (const loss of lost) {
    const key = loss.split(':')[0]!.trim();
    if (criticalKeys[providerType]?.includes(key)) {
      critical.push(loss);
    }
  }

  // Derive required adaptations
  if (providerType === 'banking') {
    const fb = fallback as unknown as BankingCapabilities;
    if (!fb.routingNumberImmediate) {
      adaptations.push('Delay routing number display until KYC approved');
    }
    if (!fb.cardIssuanceIncluded) {
      adaptations.push('Disable "Get Debit Card" flow — card requires separate Stripe Issuing approval');
    }
    if (!fb.bsaReportingBuiltIn) {
      adaptations.push('CRITICAL: Enable manual CTR filing for transactions ≥ $10,000');
    }
  }

  if (providerType === 'identity') {
    const fb = fallback as unknown as IdentityCapabilities;
    if (!fb.nfcPassportSupport) {
      adaptations.push('Disable NFC_CHIP_VERIFIED flag in certificates — Persona uses OCR only');
      adaptations.push('Update biometric thresholds for OCR-based confidence scores');
      critical.push('nfcChipVerified will be false — certificate integrity claims must be adjusted');
    }
  }

  const safeToFailover = critical.length === 0 || (
    // Allow failover with critical losses only if BSA compliance can be maintained manually
    critical.every((c) => !c.includes('fdic') && !c.includes('kycViaPassport'))
  );

  return { lostCapabilities: lost, gainedCapabilities: gained, criticalLosses: critical, safeToFailover, requiredAdaptations: adaptations };
}

// ---------------------------------------------------------------------------
// Failover validation — call before switching providers
// ---------------------------------------------------------------------------

export interface FailoverDecision {
  approved:           boolean;
  delta:              CapabilityDelta;
  requiredActions:    string[];    // must complete before going live on fallback
  automatedActions:   string[];    // system will handle automatically
  blockingReasons:    string[];    // why failover was blocked
}

export function validateFailover(
  primaryName:  string,
  fallbackName: string,
  providerType: 'banking' | 'identity' | 'bankData',
): FailoverDecision {
  const delta = computeCapabilityDelta(primaryName, fallbackName, providerType);

  const requiredActions: string[]   = [];
  const automatedActions: string[]  = [];
  const blockingReasons: string[]   = [];

  if (!delta.safeToFailover) {
    blockingReasons.push(
      `Critical capability losses detected: ${delta.criticalLosses.join(', ')}`,
    );
  }

  for (const adaptation of delta.requiredAdaptations) {
    if (adaptation.startsWith('CRITICAL')) {
      requiredActions.push(adaptation);
    } else {
      automatedActions.push(adaptation);
    }
  }

  // Log the failover decision
  logComplianceEvent('PROVIDER_FAILOVER_VALIDATED', 'system', {
    primaryName,
    fallbackName,
    providerType,
    safeToFailover:   delta.safeToFailover,
    criticalLosses:   delta.criticalLosses,
    requiredActions,
  });

  if (!delta.safeToFailover) {
    logger.error(
      { primaryName, fallbackName, providerType, criticalLosses: delta.criticalLosses },
      'PROVIDER_FAILOVER_BLOCKED: Critical capability losses would compromise compliance',
    );
  }

  return {
    approved:        delta.safeToFailover && blockingReasons.length === 0,
    delta,
    requiredActions,
    automatedActions,
    blockingReasons,
  };
}

// ---------------------------------------------------------------------------
// Runtime capability assertion — called per-operation
// FailoverError thrown if current provider lacks required capability
// ---------------------------------------------------------------------------

export class CapabilityMismatchError extends Error {
  constructor(
    public readonly provider:   string,
    public readonly capability: string,
    public readonly operation:  string,
  ) {
    super(
      `[capability-normalizer] Provider "${provider}" lacks capability "${capability}" ` +
      `required for operation "${operation}". ` +
      `This indicates a failover occurred without proper capability validation.`,
    );
    this.name = 'CapabilityMismatchError';
  }
}

export function assertCapability(
  providerName: string,
  providerType: 'banking' | 'identity' | 'bankData',
  capability:   string,
  operation:    string,
): void {
  const registry = {
    banking:  BANKING_CAPABILITIES,
    identity: IDENTITY_CAPABILITIES,
    bankData: BANK_DATA_CAPABILITIES,
  }[providerType];

  const caps = registry?.[providerName];
  if (!caps) {
    logger.warn({ providerName, providerType }, 'Provider not in capability registry');
    return; // Allow — unknown provider treated as capable
  }

  const value = (caps as unknown as Record<string, unknown>)[capability];

  if (value === false || value === 0 || value === null) {
    logComplianceEvent('CAPABILITY_MISMATCH', 'system', {
      provider:   providerName,
      capability,
      operation,
      value,
    });
    throw new CapabilityMismatchError(providerName, capability, operation);
  }
}

// ---------------------------------------------------------------------------
// Webhook normalizer — maps vendor-specific events to canonical form
// ---------------------------------------------------------------------------

export interface NormalizedWebhookEvent {
  canonical:   'KYC_APPROVED' | 'KYC_REJECTED' | 'KYC_REVIEW' | 'TRANSACTION' | 'UNKNOWN';
  customerId?: string;
  rawEvent:    string;
  rawStatus?:  string;
}

export function normalizeWebhookEvent(
  providerName: string,
  providerType: 'banking' | 'identity',
  rawPayload:   Record<string, unknown>,
): NormalizedWebhookEvent {
  if (providerType === 'banking') {
    const caps = BANKING_CAPABILITIES[providerName];
    if (!caps) return { canonical: 'UNKNOWN', rawEvent: String(rawPayload['type'] ?? '') };

    const rawEvent  = String(rawPayload['type'] ?? '');
    const rawStatus = extractNestedValue(rawPayload, 'data.object.attributes.status')
      ?? extractNestedValue(rawPayload, 'data.object.individual.verification.status')
      ?? '';

    if (rawEvent === caps.kycWebhookEvent) {
      if (rawStatus === caps.kycApprovedWebhookStatus) {
        return {
          canonical:   'KYC_APPROVED',
          customerId:  extractCustomerId(rawPayload, providerName),
          rawEvent,
          rawStatus,
        };
      }
      if (rawStatus === 'Archived' || rawStatus === 'unverified') {
        return { canonical: 'KYC_REJECTED', customerId: extractCustomerId(rawPayload, providerName), rawEvent, rawStatus };
      }
      return { canonical: 'KYC_REVIEW', customerId: extractCustomerId(rawPayload, providerName), rawEvent, rawStatus };
    }
  }

  if (providerType === 'identity') {
    const caps      = IDENTITY_CAPABILITIES[providerName];
    const rawEvent  = String(rawPayload['type'] ?? '');
    const rawStatus = extractNestedValue(rawPayload, 'data.status') ?? '';

    if (caps && rawEvent === caps.webhookEvent) {
      if (rawStatus === caps.approvedWebhookStatus) return { canonical: 'KYC_APPROVED', rawEvent, rawStatus };
      return { canonical: 'KYC_REJECTED', rawEvent, rawStatus };
    }
  }

  return { canonical: 'UNKNOWN', rawEvent: String(rawPayload['type'] ?? '') };
}

function extractNestedValue(obj: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : undefined;
}

function extractCustomerId(payload: Record<string, unknown>, providerName: string): string | undefined {
  // Unit.co: data.relationships.customer.data.id
  const unitId = extractNestedValue(payload, 'data.relationships.customer.data.id');
  if (unitId) return unitId;
  // Stripe: data.object.customer
  const stripeId = extractNestedValue(payload, 'data.object.customer');
  if (stripeId) return stripeId;
  return undefined;
}
