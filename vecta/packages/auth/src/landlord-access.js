"use strict";
/**
 * packages/auth/src/landlord-access.ts
 *
 * Landlord access tiering — not all landlords get the same view.
 *
 * | Tier       | How achieved            | What they can do                          |
 * |------------|-------------------------|-------------------------------------------|
 * | ANONYMOUS  | Raw token URL           | View identity summary only                |
 * | VERIFIED   | Email verified + signed | Download LoC PDF, view trust score detail |
 * | TRUSTED    | Background check done   | Accept tenant, initiate lease flow        |
 *
 * This enforces the review's requirement:
 *   "View identity → token only"
 *   "Download LoC  → authenticated (verified) landlord"
 *   "Accept tenant → verified landlord"
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.landlordCan = landlordCan;
exports.requireLandlordPermission = requireLandlordPermission;
exports.buildLandlordContext = buildLandlordContext;
exports.filterViewForTier = filterViewForTier;
const database_1 = require("@vecta/database");
const logger_1 = require("@vecta/logger");
const logger = (0, logger_1.createLogger)('landlord-access');
// ---------------------------------------------------------------------------
// Permissions per tier
// ---------------------------------------------------------------------------
const TIER_PERMISSIONS = {
    ANONYMOUS: [
        'view:identity_summary', // Name, face, visa status, NFC badge
        'view:trust_score', // Score number + tier label
        'view:university', // University name + enrollment status
        'view:contact_info', // Phone + email
    ],
    VERIFIED: [
        'view:identity_summary',
        'view:trust_score',
        'view:university',
        'view:contact_info',
        'download:letter_of_credit', // Full LoC PDF download
        'view:trust_score_breakdown', // Detailed factor breakdown
        'view:solvency_detail', // Guarantee months, max rent approval
    ],
    TRUSTED: [
        'view:identity_summary',
        'view:trust_score',
        'view:university',
        'view:contact_info',
        'download:letter_of_credit',
        'view:trust_score_breakdown',
        'view:solvency_detail',
        'action:initiate_lease', // Start formal lease flow
        'action:accept_tenant', // Mark tenant as accepted
        'action:request_references', // Request additional references
    ],
};
// ---------------------------------------------------------------------------
// Check if a landlord context has a specific permission
// ---------------------------------------------------------------------------
function landlordCan(ctx, permission) {
    return TIER_PERMISSIONS[ctx.tier].includes(permission);
}
function requireLandlordPermission(ctx, permission) {
    if (!landlordCan(ctx, permission)) {
        logger.warn({
            tier: ctx.tier,
            permission,
            landlordId: ctx.landlordId,
        }, 'Landlord access denied');
        const upgradeMessage = {
            'download:letter_of_credit': 'Verify your email address to download the Letter of Credit.',
            'action:accept_tenant': 'Complete landlord verification to initiate a lease.',
            'action:initiate_lease': 'Complete landlord verification to initiate a lease.',
        };
        throw Object.assign(new Error(`Access denied: ${permission} requires tier above ${ctx.tier}`), {
            code: 'LANDLORD_TIER_INSUFFICIENT',
            tier: ctx.tier,
            permission,
            upgradeMessage: upgradeMessage[permission] ?? 'Upgrade your landlord account to access this feature.',
        });
    }
}
// ---------------------------------------------------------------------------
// Build access context from request headers + optional DB lookup
// ---------------------------------------------------------------------------
async function buildLandlordContext(ipAddress, userAgent, landlordEmail) {
    if (!landlordEmail) {
        return { tier: 'ANONYMOUS', ipAddress, userAgent };
    }
    // Look up landlord in DB
    const landlord = await (0, database_1.queryOne)(`SELECT id, email, email_verified, background_check_status
     FROM landlord_profiles
     WHERE email = $1`, [landlordEmail]);
    if (!landlord || !landlord.email_verified) {
        return {
            tier: 'ANONYMOUS',
            ipAddress,
            userAgent,
            landlordEmail,
        };
    }
    const tier = landlord.background_check_status === 'APPROVED' ? 'TRUSTED' : 'VERIFIED';
    return {
        landlordId: landlord.id,
        landlordEmail: landlord.email,
        tier,
        ipAddress,
        userAgent,
    };
}
// ---------------------------------------------------------------------------
// Middleware factory for Next.js server components (landlord portal)
// ---------------------------------------------------------------------------
function filterViewForTier(fullView, ctx) {
    const filtered = {};
    // Always included
    const alwaysIncluded = [
        'fullName', 'selfieUrl', 'idStatus', 'visaType', 'universityName',
        'vectaTrustScore', 'trustScoreTier', 'usPhoneNumber', 'verifiedEmail',
        'tokenExpiresAt', 'generatedAt',
    ];
    for (const key of alwaysIncluded) {
        if (key in fullView)
            filtered[key] = fullView[key];
    }
    // VERIFIED+ fields
    if (landlordCan(ctx, 'download:letter_of_credit')) {
        for (const key of ['letterOfCreditId', 'solvencyGuaranteeMonths', 'rentSplitEnabled']) {
            if (key in fullView)
                filtered[key] = fullView[key];
        }
    }
    // VERIFIED+ score breakdown
    if (landlordCan(ctx, 'view:trust_score_breakdown')) {
        if ('trustScoreBreakdown' in fullView)
            filtered['trustScoreBreakdown'] = fullView['trustScoreBreakdown'];
        if ('maxRentApproval' in fullView)
            filtered['maxRentApproval'] = fullView['maxRentApproval'];
        if ('depositMultiplier' in fullView)
            filtered['depositMultiplier'] = fullView['depositMultiplier'];
    }
    // Always vault these — never in any tier
    // (passportNumber, nationality, countryOfOrigin, bankBalance, imei, etc.)
    // These should never be in fullView to begin with, but belt-and-suspenders:
    const hardVault = [
        'passportNumber', 'nationality', 'countryOfOrigin',
        'bankBalance', 'accountNumber', 'routingNumber',
        'imei', 'ssn', 'taxId', 'homeAddress',
    ];
    for (const key of hardVault) {
        delete filtered[key];
    }
    return filtered;
}
//# sourceMappingURL=landlord-access.js.map