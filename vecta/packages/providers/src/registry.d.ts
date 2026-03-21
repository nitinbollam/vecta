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
import type { ProviderRegistry, ProviderHealthCheck } from './interfaces';
export declare function getProviderRegistry(): ProviderRegistry;
export declare function checkAllProviderHealth(): Promise<ProviderHealthCheck[]>;
//# sourceMappingURL=registry.d.ts.map