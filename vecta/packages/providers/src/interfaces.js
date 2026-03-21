"use strict";
/**
 * packages/providers/src/interfaces.ts
 *
 * Vendor-agnostic provider contracts.
 *
 * Every external dependency implements one of these interfaces.
 * The application layer only imports these types — never concrete vendor SDKs.
 *
 * Swap strategy:
 *   1. Add a new class implementing the interface
 *   2. Update PROVIDER_CONFIG[service] in registry.ts
 *   3. Deploy — zero schema changes, zero application code changes
 *
 * Current implementations:
 *   Banking:     UnitProvider  (primary) → StripeProvider (standby)
 *   Identity:    DiditProvider (primary) → PersonaProvider (standby)
 *   BankData:    PlaidProvider (primary) → MXProvider (standby)
 *   Credit:      NovaCreditProvider (primary) → FairplayProvider (standby)
 *   eSIM:        ESIMGoProvider (primary) → AloSIMProvider (standby)
 */
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=interfaces.js.map