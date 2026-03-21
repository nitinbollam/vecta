"use strict";
/**
 * packages/providers/src/registry.ts
 *
 * Provider registry with automatic failover.
 *
 * Configuration is purely through environment variables:
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProviderRegistry = getProviderRegistry;
exports.checkAllProviderHealth = checkAllProviderHealth;
const logger_1 = require("@vecta/logger");
const logger = (0, logger_1.createLogger)('provider-registry');
// ---------------------------------------------------------------------------
// Provider adapters (thin wrappers that implement the interface)
// ---------------------------------------------------------------------------
/** Banking: Unit.co → Stripe Treasury */
function makeBankingProvider(name) {
    switch (name) {
        case 'unit':
            return new (require('./adapters/unit.adapter').UnitAdapter)();
        case 'stripe':
            return new (require('./adapters/stripe-treasury.adapter').StripeTreasuryAdapter)();
        default:
            throw new Error(`[providers] Unknown banking provider: ${name}`);
    }
}
/** Identity: Didit → Persona */
function makeIdentityProvider(name) {
    switch (name) {
        case 'didit':
            return new (require('./adapters/didit.adapter').DiditAdapter)();
        case 'persona':
            return new (require('./adapters/persona.adapter').PersonaAdapter)();
        default:
            throw new Error(`[providers] Unknown identity provider: ${name}`);
    }
}
/** Bank data: Plaid → MX */
function makeBankDataProvider(name) {
    switch (name) {
        case 'plaid':
            return new (require('./adapters/plaid.adapter').PlaidAdapter)();
        case 'mx':
            return new (require('./adapters/mx.adapter').MXAdapter)();
        default:
            throw new Error(`[providers] Unknown bank data provider: ${name}`);
    }
}
/** Credit: Nova Credit → Fairplay */
function makeCreditProvider(name) {
    switch (name) {
        case 'nova':
            return new (require('./adapters/nova-credit.adapter').NovaCreditAdapter)();
        case 'fairplay':
            return new (require('./adapters/fairplay.adapter').FairplayAdapter)();
        default:
            throw new Error(`[providers] Unknown credit provider: ${name}`);
    }
}
/** eSIM: eSIM Go → AloSIM */
function makeESIMProvider(name) {
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
async function withFailover(primaryName, fallbackName, call, fallbackCall, operation) {
    try {
        return await call();
    }
    catch (primaryErr) {
        logger.error({ provider: primaryName, operation, err: primaryErr }, 'Primary provider failed');
        if (!fallbackCall || !fallbackName) {
            throw primaryErr;
        }
        logger.warn({ primary: primaryName, fallback: fallbackName, operation }, 'PROVIDER_FAILOVER: switching to fallback provider');
        // Audit the failover (non-blocking)
        void Promise.resolve().then(() => __importStar(require('@vecta/logger'))).then(({ logAuditEvent }) => {
            logAuditEvent('PROVIDER_FAILOVER', 'system', operation, {
                primary: primaryName,
                fallback: fallbackName,
                errorCode: primaryErr.code ?? 'UNKNOWN',
            });
        });
        return await fallbackCall();
    }
}
// ---------------------------------------------------------------------------
// Singleton registry
// ---------------------------------------------------------------------------
let _registry = null;
function getProviderRegistry() {
    if (_registry)
        return _registry;
    const bankingName = process.env.BANKING_PROVIDER ?? 'unit';
    const identityName = process.env.IDENTITY_PROVIDER ?? 'didit';
    const bankDataName = process.env.BANK_DATA_PROVIDER ?? 'plaid';
    const creditName = process.env.CREDIT_PROVIDER ?? 'nova';
    const esimName = process.env.ESIM_PROVIDER ?? 'esimgo';
    const bankingFallbackName = process.env.BANKING_PROVIDER_FALLBACK ?? 'stripe';
    const identityFallbackName = process.env.IDENTITY_PROVIDER_FALLBACK ?? 'persona';
    const bankDataFallbackName = process.env.BANK_DATA_PROVIDER_FALLBACK ?? 'mx';
    const creditFallbackName = process.env.CREDIT_PROVIDER_FALLBACK ?? 'fairplay';
    const esimFallbackName = process.env.ESIM_PROVIDER_FALLBACK ?? 'alosim';
    // Lazy-load adapters so startup doesn't fail if a fallback SDK isn't installed
    const primaryBanking = makeBankingProvider(bankingName);
    const primaryIdentity = makeIdentityProvider(identityName);
    const primaryBankData = makeBankDataProvider(bankDataName);
    const primaryCredit = makeCreditProvider(creditName);
    const primaryESIM = makeESIMProvider(esimName);
    logger.info({
        banking: bankingName,
        identity: identityName,
        bankData: bankDataName,
        credit: creditName,
        esim: esimName,
    }, 'Provider registry initialised');
    // Wrap primary providers with failover logic
    _registry = {
        banking: {
            ...primaryBanking,
            provision: (studentId, passport) => withFailover(bankingName, bankingFallbackName, () => primaryBanking.provision(studentId, passport), () => makeBankingProvider(bankingFallbackName).provision(studentId, passport), 'banking.provision'),
            getKYCStatus: (id) => withFailover(bankingName, bankingFallbackName, () => primaryBanking.getKYCStatus(id), () => makeBankingProvider(bankingFallbackName).getKYCStatus(id), 'banking.getKYCStatus'),
            getBalance: (id) => withFailover(bankingName, null, () => primaryBanking.getBalance(id), null, 'banking.getBalance'),
            getTransactions: (id, limit) => withFailover(bankingName, null, () => primaryBanking.getTransactions(id, limit), null, 'banking.getTransactions'),
            handleWebhook: primaryBanking.handleWebhook.bind(primaryBanking),
        },
        identity: {
            ...primaryIdentity,
            initiateVerification: (studentId, returnUrl) => withFailover(identityName, identityFallbackName, () => primaryIdentity.initiateVerification(studentId, returnUrl), () => makeIdentityProvider(identityFallbackName).initiateVerification(studentId, returnUrl), 'identity.initiateVerification'),
            processWebhook: primaryIdentity.processWebhook.bind(primaryIdentity),
        },
        bankData: {
            ...primaryBankData,
            createLinkToken: (studentId, products) => withFailover(bankDataName, bankDataFallbackName, () => primaryBankData.createLinkToken(studentId, products), () => makeBankDataProvider(bankDataFallbackName).createLinkToken(studentId, products), 'bankData.createLinkToken'),
            exchangePublicToken: (token) => withFailover(bankDataName, null, () => primaryBankData.exchangePublicToken(token), null, 'bankData.exchangePublicToken'),
            getAssetReport: (accessToken, days) => withFailover(bankDataName, bankDataFallbackName, () => primaryBankData.getAssetReport(accessToken, days), () => makeBankDataProvider(bankDataFallbackName).getAssetReport(accessToken, days), 'bankData.getAssetReport'),
            handleWebhook: primaryBankData.handleWebhook.bind(primaryBankData),
        },
        credit: {
            ...primaryCredit,
            fetchCreditHistory: (params) => withFailover(creditName, creditFallbackName, () => primaryCredit.fetchCreditHistory(params), () => makeCreditProvider(creditFallbackName).fetchCreditHistory(params), 'credit.fetchCreditHistory'),
        },
        esim: {
            ...primaryESIM,
            provision: (params) => withFailover(esimName, esimFallbackName, () => primaryESIM.provision(params), () => makeESIMProvider(esimFallbackName).provision(params), 'esim.provision'),
            validateIMEI: primaryESIM.validateIMEI.bind(primaryESIM),
        },
    };
    return _registry;
}
// ---------------------------------------------------------------------------
// Health checks for ops dashboard
// ---------------------------------------------------------------------------
async function checkAllProviderHealth() {
    const registry = getProviderRegistry();
    const checks = [];
    const probe = async (name, fn) => {
        const start = Date.now();
        try {
            await fn();
            return { providerName: name, healthy: true, latencyMs: Date.now() - start, lastCheckedAt: new Date().toISOString() };
        }
        catch (err) {
            return {
                providerName: name, healthy: false,
                latencyMs: Date.now() - start,
                lastCheckedAt: new Date().toISOString(),
                error: err instanceof Error ? err.message : 'Unknown error',
            };
        }
    };
    const results = await Promise.allSettled([
        probe(registry.banking.name, () => registry.banking.getKYCStatus('health-check')),
        probe(registry.identity.name, () => Promise.resolve()), // Identity: no lightweight ping
        probe(registry.bankData.name, () => registry.bankData.createLinkToken('health-check', [])),
        probe(registry.credit.name, () => Promise.resolve()),
        probe(registry.esim.name, () => registry.esim.validateIMEI('000000000000000')),
    ]);
    for (const result of results) {
        if (result.status === 'fulfilled') {
            checks.push(result.value);
        }
    }
    return checks;
}
//# sourceMappingURL=registry.js.map