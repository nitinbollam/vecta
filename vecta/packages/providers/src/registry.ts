/**
 * packages/providers/src/registry.ts
 *
 * Provider registry with automatic failover.
 *
 * ── Vertical Fortress defaults (in-house first) ──────────────────────────────
 *   IDENTITY_PROVIDER=vecta-id     → VectaID (ICAO NFC)   → fallback: didit
 *   BANKING_PROVIDER=vecta-ledger  → VectaLedger          → fallback: unit
 *   BANK_DATA_PROVIDER=vecta-connect→VectaConnect (OB)    → fallback: plaid
 *   CREDIT_PROVIDER=vecta-bridge   → VectaCreditBridge    → fallback: nova
 *   INSURANCE_PROVIDER=vecta-mga   → VectaMGA             → fallback: lemonade
 *
 * ── Legacy defaults (main branch) ───────────────────────────────────────────
 *   BANKING_PROVIDER=unit          → uses UnitProvider
 *   BANKING_PROVIDER=stripe        → uses StripeProvider (standby)
 *   IDENTITY_PROVIDER=didit        → uses DiditProvider
 *   IDENTITY_PROVIDER=persona      → uses PersonaProvider
 *   BANK_DATA_PROVIDER=plaid       → uses PlaidProvider
 *   BANK_DATA_PROVIDER=mx          → uses MXProvider
 *   CREDIT_PROVIDER=nova           → uses NovaCreditProvider
 *   CREDIT_PROVIDER=fairplay       → uses FairplayProvider
 *   ESIM_PROVIDER=esimgo           → uses ESIMGoProvider
 *   ESIM_PROVIDER=alosim           → uses AloSIMProvider
 *
 * Failover:
 *   Each call is wrapped in a health-aware try/catch.
 *   If a provider returns 5xx or times out, the registry tries the fallback.
 *   Failovers are logged as PROVIDER_FAILOVER events in the audit log.
 *   Schema is never touched during failover.
 */

import { createLogger } from '@vecta/logger';
import type {
  BankingProvider, IdentityProvider, BankDataProvider,
  CreditProvider, ESIMProvider, ProviderRegistry, ProviderHealthCheck,
} from './interfaces';

const logger = createLogger('provider-registry');

// ---------------------------------------------------------------------------
// Provider adapters (thin wrappers that implement the interface)
// ---------------------------------------------------------------------------

/** Banking: VectaLedger → Unit.co → Stripe Treasury */
function makeBankingProvider(name: string): BankingProvider {
  switch (name) {
    case 'vecta-ledger':
      // VectaLedger implements a compatible subset of BankingProvider
      return new (require('./adapters/vecta-ledger.adapter').VectaLedgerAdapter)();
    case 'unit':
      return new (require('./adapters/unit.adapter').UnitAdapter)();
    case 'stripe':
      return new (require('./adapters/stripe-treasury.adapter').StripeTreasuryAdapter)();
    default:
      throw new Error(`[providers] Unknown banking provider: ${name}`);
  }
}

/** Identity: VectaID → Didit → Persona */
function makeIdentityProvider(name: string): IdentityProvider {
  switch (name) {
    case 'vecta-id':
      // VectaID NFC pipeline — no external API dependency
      return new (require('./adapters/vecta-id.adapter').VectaIDAdapter)();
    case 'didit':
      return new (require('./adapters/didit.adapter').DiditAdapter)();
    case 'persona':
      return new (require('./adapters/persona.adapter').PersonaAdapter)();
    default:
      throw new Error(`[providers] Unknown identity provider: ${name}`);
  }
}

/** Bank data: VectaConnect → Plaid → MX */
function makeBankDataProvider(name: string): BankDataProvider {
  switch (name) {
    case 'vecta-connect':
      return new (require('./adapters/vecta-connect.adapter').VectaConnectAdapter)();
    case 'plaid':
      return new (require('./adapters/plaid.adapter').PlaidAdapter)();
    case 'mx':
      return new (require('./adapters/mx.adapter').MXAdapter)();
    default:
      throw new Error(`[providers] Unknown bank data provider: ${name}`);
  }
}

/** Credit: VectaBridge → Nova Credit → Fairplay */
function makeCreditProvider(name: string): CreditProvider {
  switch (name) {
    case 'vecta-bridge':
      return new (require('./adapters/vecta-bridge.adapter').VectaBridgeAdapter)();
    case 'nova':
      return new (require('./adapters/nova-credit.adapter').NovaCreditAdapter)();
    case 'fairplay':
      return new (require('./adapters/fairplay.adapter').FairplayAdapter)();
    default:
      throw new Error(`[providers] Unknown credit provider: ${name}`);
  }
}

/** eSIM: eSIM Go → AloSIM */
function makeESIMProvider(name: string): ESIMProvider {
  switch (name) {
    case 'esimgo':
      return new (require('./adapters/esim-go.adapter').ESIMGoAdapter)();
    case 'alosim':
      return new (require('./adapters/alosim.adapter').AloSIMAdapter)();
    default:
      throw new Error(`[providers] Unknown eSIM provider: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// Failover wrapper
// ---------------------------------------------------------------------------

async function withFailover<T>(
  primaryName: string,
  fallbackName: string | null,
  call: () => Promise<T>,
  fallbackCall: (() => Promise<T>) | null,
  operation: string,
): Promise<T> {
  try {
    return await call();
  } catch (primaryErr) {
    logger.error(
      { provider: primaryName, operation, err: primaryErr },
      'Primary provider failed',
    );

    if (!fallbackCall || !fallbackName) {
      throw primaryErr;
    }

    logger.warn(
      { primary: primaryName, fallback: fallbackName, operation },
      'PROVIDER_FAILOVER: switching to fallback provider',
    );

    // Audit the failover (non-blocking)
    void import('@vecta/logger').then(({ logAuditEvent }) => {
      logAuditEvent('PROVIDER_FAILOVER', 'system', operation, {
        primary:   primaryName,
        fallback:  fallbackName,
        errorCode: (primaryErr as NodeJS.ErrnoException).code ?? 'UNKNOWN',
      });
    });

    return await fallbackCall();
  }
}

// ---------------------------------------------------------------------------
// Singleton registry
// ---------------------------------------------------------------------------

let _registry: ProviderRegistry | null = null;

export function getProviderRegistry(): ProviderRegistry {
  if (_registry) return _registry;

  // Vertical Fortress: in-house providers are the new defaults
  const bankingName  = process.env.BANKING_PROVIDER   ?? 'vecta-ledger';
  const identityName = process.env.IDENTITY_PROVIDER  ?? 'vecta-id';
  const bankDataName = process.env.BANK_DATA_PROVIDER ?? 'vecta-connect';
  const creditName   = process.env.CREDIT_PROVIDER    ?? 'vecta-bridge';
  const esimName     = process.env.ESIM_PROVIDER      ?? 'esimgo';

  // Fallbacks: legacy external APIs
  const bankingFallbackName  = process.env.BANKING_PROVIDER_FALLBACK   ?? 'unit';
  const identityFallbackName = process.env.IDENTITY_PROVIDER_FALLBACK  ?? 'didit';
  const bankDataFallbackName = process.env.BANK_DATA_PROVIDER_FALLBACK ?? 'plaid';
  const creditFallbackName   = process.env.CREDIT_PROVIDER_FALLBACK    ?? 'nova';
  const esimFallbackName     = process.env.ESIM_PROVIDER_FALLBACK      ?? 'alosim';

  // Lazy-load adapters so startup doesn't fail if a fallback SDK isn't installed
  const primaryBanking   = makeBankingProvider(bankingName);
  const primaryIdentity  = makeIdentityProvider(identityName);
  const primaryBankData  = makeBankDataProvider(bankDataName);
  const primaryCredit    = makeCreditProvider(creditName);
  const primaryESIM      = makeESIMProvider(esimName);

  logger.info({
    banking:  bankingName,
    identity: identityName,
    bankData: bankDataName,
    credit:   creditName,
    esim:     esimName,
  }, 'Provider registry initialised');

  // Wrap primary providers with failover logic
  _registry = {
    banking: {
      ...primaryBanking,
      provision: (studentId, passport) =>
        withFailover(
          bankingName, bankingFallbackName,
          () => primaryBanking.provision(studentId, passport),
          () => makeBankingProvider(bankingFallbackName).provision(studentId, passport),
          'banking.provision',
        ),
      getKYCStatus: (id) =>
        withFailover(
          bankingName, bankingFallbackName,
          () => primaryBanking.getKYCStatus(id),
          () => makeBankingProvider(bankingFallbackName).getKYCStatus(id),
          'banking.getKYCStatus',
        ),
      getBalance: (id) =>
        withFailover(
          bankingName, null,
          () => primaryBanking.getBalance(id),
          null,
          'banking.getBalance',
        ),
      getTransactions: (id, limit) =>
        withFailover(
          bankingName, null,
          () => primaryBanking.getTransactions(id, limit),
          null,
          'banking.getTransactions',
        ),
      handleWebhook: primaryBanking.handleWebhook.bind(primaryBanking),
    },

    identity: {
      ...primaryIdentity,
      initiateVerification: (studentId, returnUrl) =>
        withFailover(
          identityName, identityFallbackName,
          () => primaryIdentity.initiateVerification(studentId, returnUrl),
          () => makeIdentityProvider(identityFallbackName).initiateVerification(studentId, returnUrl),
          'identity.initiateVerification',
        ),
      processWebhook: primaryIdentity.processWebhook.bind(primaryIdentity),
    },

    bankData: {
      ...primaryBankData,
      createLinkToken: (studentId, products) =>
        withFailover(
          bankDataName, bankDataFallbackName,
          () => primaryBankData.createLinkToken(studentId, products),
          () => makeBankDataProvider(bankDataFallbackName).createLinkToken(studentId, products),
          'bankData.createLinkToken',
        ),
      exchangePublicToken: (token) =>
        withFailover(
          bankDataName, null,
          () => primaryBankData.exchangePublicToken(token),
          null,
          'bankData.exchangePublicToken',
        ),
      getAssetReport: (accessToken, days) =>
        withFailover(
          bankDataName, bankDataFallbackName,
          () => primaryBankData.getAssetReport(accessToken, days),
          () => makeBankDataProvider(bankDataFallbackName).getAssetReport(accessToken, days),
          'bankData.getAssetReport',
        ),
      handleWebhook: primaryBankData.handleWebhook.bind(primaryBankData),
    },

    credit: {
      ...primaryCredit,
      fetchCreditHistory: (params) =>
        withFailover(
          creditName, creditFallbackName,
          () => primaryCredit.fetchCreditHistory(params),
          () => makeCreditProvider(creditFallbackName).fetchCreditHistory(params),
          'credit.fetchCreditHistory',
        ),
    },

    esim: {
      ...primaryESIM,
      provision: (params) =>
        withFailover(
          esimName, esimFallbackName,
          () => primaryESIM.provision(params),
          () => makeESIMProvider(esimFallbackName).provision(params),
          'esim.provision',
        ),
      validateIMEI: primaryESIM.validateIMEI.bind(primaryESIM),
    },
  };

  return _registry;
}

// ---------------------------------------------------------------------------
// Health checks for ops dashboard
// ---------------------------------------------------------------------------

export async function checkAllProviderHealth(): Promise<ProviderHealthCheck[]> {
  const registry = getProviderRegistry();
  const checks: ProviderHealthCheck[] = [];

  const probe = async (name: string, fn: () => Promise<unknown>): Promise<ProviderHealthCheck> => {
    const start = Date.now();
    try {
      await fn();
      return { providerName: name, healthy: true, latencyMs: Date.now() - start, lastCheckedAt: new Date().toISOString() };
    } catch (err) {
      return {
        providerName: name, healthy: false,
        latencyMs: Date.now() - start,
        lastCheckedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  };

  const results = await Promise.allSettled([
    probe(registry.banking.name,  () => registry.banking.getKYCStatus('health-check')),
    probe(registry.identity.name, () => Promise.resolve()), // Identity: no lightweight ping
    probe(registry.bankData.name, () => registry.bankData.createLinkToken('health-check', [])),
    probe(registry.credit.name,   () => Promise.resolve()),
    probe(registry.esim.name,     () => registry.esim.validateIMEI('000000000000000')),
  ]);

  for (const result of results) {
    if (result.status === 'fulfilled') {
      checks.push(result.value);
    }
  }

  return checks;
}
