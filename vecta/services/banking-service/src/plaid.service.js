"use strict";
// services/banking-service/src/plaid.service.ts
// ─── Plaid Integration — Proof of Solvency & Letter of Credit ────────────────
// Generates a cryptographically signed LoC PDF that landlords can download.
// The student's exact balance is NEVER exposed — only the guarantee statement.
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaidError = exports.SolvencyService = void 0;
exports.getMaskedBalance = getMaskedBalance;
exports.handleItemError = handleItemError;
const crypto_1 = __importDefault(require("crypto"));
const plaid_1 = require("plaid");
const storage_1 = require("@vecta/storage");
const logger_1 = require("@vecta/logger");
const loc_pdf_generator_1 = require("./loc-pdf.generator");
const logger = (0, logger_1.createLogger)("banking-plaid");
// ─── Plaid Client ─────────────────────────────────────────────────────────────
function buildPlaidClient() {
    const env = (process.env.PLAID_ENV ?? "sandbox");
    const basePath = String(plaid_1.PlaidEnvironments[env] ?? plaid_1.PlaidEnvironments.sandbox);
    const config = new plaid_1.Configuration({
        basePath,
        baseOptions: {
            headers: {
                "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
                "PLAID-SECRET": process.env.PLAID_SECRET,
            },
        },
    });
    return new plaid_1.PlaidApi(config);
}
// ─── Solvency Service ─────────────────────────────────────────────────────────
class SolvencyService {
    db;
    redis;
    plaid;
    signingKey; // HMAC key for cryptographic hash
    constructor(db, redis) {
        this.db = db;
        this.redis = redis;
        this.plaid = buildPlaidClient();
        this.signingKey = process.env.LOC_SIGNING_KEY;
        if (!this.signingKey) {
            throw new Error("LOC_SIGNING_KEY required — set a 256-bit key for LoC signing.");
        }
    }
    // ─── Step 1: Create Plaid Link Token ─────────────────────────────────────
    // The student's app uses this to open the Plaid SDK for bank account linking.
    async createLinkToken(studentId) {
        const cached = await this.redis.get(`vecta:plaid:link:${studentId}`);
        if (cached)
            return { linkToken: cached };
        const response = await this.plaid.linkTokenCreate({
            user: { client_user_id: studentId },
            client_name: "Vecta",
            products: [plaid_1.Products.Assets],
            country_codes: [plaid_1.CountryCode.Us, plaid_1.CountryCode.Ca, plaid_1.CountryCode.Gb],
            language: "en",
            webhook: `${process.env.API_GATEWAY_URL}/webhooks/plaid`,
            // Allow international institutions for F-1 students' home-country banks
            auth: { automated_microdeposits_enabled: true },
        });
        const linkToken = response.data.link_token;
        // Cache for 30 minutes (Plaid tokens expire)
        await this.redis.setex(`vecta:plaid:link:${studentId}`, 1800, linkToken);
        return { linkToken };
    }
    // ─── Step 2: Exchange Public Token ───────────────────────────────────────
    async exchangePublicToken(studentId, publicToken) {
        const response = await this.plaid.itemPublicTokenExchange({ public_token: publicToken });
        const accessToken = response.data.access_token;
        // Encrypt and store access token — never plaintext in DB
        const encryptedToken = this.encryptAES(accessToken);
        await this.db.query(`INSERT INTO student_plaid_connections (student_id, access_token_enc, item_id, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (student_id) DO UPDATE
       SET access_token_enc = EXCLUDED.access_token_enc,
           item_id = EXCLUDED.item_id,
           updated_at = NOW()`, [studentId, encryptedToken, response.data.item_id]);
        return { accessTokenStored: true };
    }
    // ─── Step 3: Generate Letter of Credit ───────────────────────────────────
    // Pulls an Asset Report from Plaid, verifies solvency (12 months rent),
    // and produces a cryptographically signed PDF + JSON report.
    async generateLetterOfCredit(params) {
        // 1. Fetch encrypted access token
        const connResult = await this.db.query("SELECT access_token_enc FROM student_plaid_connections WHERE student_id = $1", [params.studentId]);
        if (!connResult.rows[0]) {
            throw new PlaidError("No bank account linked. Please connect a bank account first.");
        }
        const accessToken = this.decryptAES(connResult.rows[0].access_token_enc);
        // 2. Create Plaid Asset Report (30-day lookback for pre-arrival students)
        const nameParts = params.studentFullName.trim().split(/\s+/).filter(Boolean);
        const firstName = nameParts[0] ?? "Student";
        const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;
        const assetReportCreateRes = await this.plaid.assetReportCreate({
            access_tokens: [accessToken],
            days_requested: 90,
            options: {
                client_report_id: `vecta-loc-${params.studentId}-${Date.now()}`,
                webhook: `${process.env.API_GATEWAY_URL}/webhooks/plaid/asset-report`,
                user: {
                    client_user_id: params.studentId,
                    first_name: firstName,
                    last_name: lastName,
                },
            },
        });
        const assetReportToken = assetReportCreateRes.data.asset_report_token;
        // 3. Poll for report readiness (async in production — webhook is preferred)
        const report = await this.pollAssetReport(assetReportToken);
        // 4. Sum verified balances across all accounts
        let totalVerifiedBalanceCents = 0;
        for (const item of report.report.items ?? []) {
            for (const account of item.accounts ?? []) {
                if (account.balances.current && account.balances.current > 0) {
                    totalVerifiedBalanceCents += Math.round(account.balances.current * 100);
                }
            }
        }
        const totalVerifiedBalanceUSD = totalVerifiedBalanceCents / 100;
        const required12MonthsRent = params.monthlyRentEstimateUSD * 12;
        const solvencyConfirmed = totalVerifiedBalanceUSD >= required12MonthsRent;
        const guaranteedMonths = Math.floor(totalVerifiedBalanceUSD / params.monthlyRentEstimateUSD);
        // 5. Build the solvency report (WITHOUT exact balance — "sufficient/insufficient")
        const reportId = crypto_1.default.randomUUID();
        const guaranteeStatement = solvencyConfirmed
            ? `Vecta has verified that ${params.studentFullName} has sufficient funds to cover ` +
                `${guaranteedMonths} months of rent at the requested amount. ` +
                `Vecta acts as financial guarantor for the security deposit equivalent to 1 month's rent.`
            : `Verification inconclusive. Please request additional documentation.`;
        const solvencyReport = {
            studentId: params.studentId,
            reportId,
            verifiedAt: new Date().toISOString(),
            totalVerifiedBalanceUSD, // Stored in our DB, NEVER in JWT or API response to landlord
            monthsRentCoverage: guaranteedMonths,
            guaranteeStatement,
            cryptographicHash: "", // Filled in below
            signatureKeyId: process.env.LOC_KMS_KEY_ID ?? "local",
        };
        // 6. Generate cryptographic hash of the report
        const reportStringToSign = JSON.stringify({
            reportId,
            studentId: params.studentId,
            guaranteedMonths,
            solvencyConfirmed,
            verifiedAt: solvencyReport.verifiedAt,
            guaranteeStatement,
        });
        solvencyReport.cryptographicHash = crypto_1.default
            .createHmac("sha256", this.signingKey)
            .update(reportStringToSign)
            .digest("hex");
        // 7. Generate branded PDF
        const pdfBuffer = await (0, loc_pdf_generator_1.generateLocPDF)({
            studentFullName: params.studentFullName,
            universityName: params.universityName,
            reportId,
            guaranteedMonths,
            guaranteeStatement,
            cryptographicHash: solvencyReport.cryptographicHash,
            generatedAt: solvencyReport.verifiedAt,
            ...(params.landlordName !== undefined ? { landlordName: params.landlordName } : {}),
        });
        // 8. Upload PDF to S3 (housing LoC bucket layout)
        const { key: s3Key, signedUrl: pdfDownloadUrl } = await (0, storage_1.uploadLocPdf)(params.studentId, reportId, pdfBuffer);
        // 9. Persist to DB (balance stored encrypted — landlord API only gets summary)
        await this.db.query(`INSERT INTO letters_of_credit
        (id, student_id, plaid_report_id, guaranteed_months, total_balance_usd,
         crypto_hash, signature_key_id, s3_pdf_key, generated_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(), NOW() + INTERVAL '30 days')`, [
            reportId,
            params.studentId,
            report.report.report_id ?? reportId,
            guaranteedMonths,
            totalVerifiedBalanceCents, // Stored as cents, encrypted at DB level (column encryption)
            solvencyReport.cryptographicHash,
            solvencyReport.signatureKeyId,
            s3Key,
        ]);
        // Update verified_balance_usd on Plaid connection (used by trust engine liquidity factor)
        await this.db.query(`UPDATE student_plaid_connections
       SET verified_balance_usd  = $2,
           balance_verified_at   = NOW(),
           last_successful_update = NOW(),
           updated_at            = NOW()
       WHERE student_id = $1 AND status = 'active'`, [params.studentId, totalVerifiedBalanceCents / 100]);
        logger.info({
            event: "LETTER_OF_CREDIT_GENERATED",
            studentId: params.studentId,
            reportId,
            solvencyConfirmed,
            guaranteedMonths,
        });
        // Email/push: call identity-service over HTTP in production, or extend with a shared package.
        logger.info({ studentId: params.studentId, reportId }, "LoC generated — wire IDENTITY_SERVICE_URL notifications if needed");
        return { reportId, pdfDownloadUrl, solvencyConfirmed, guaranteedMonths };
    }
    // ─── Poll Asset Report (with exponential backoff) ────────────────────────
    async pollAssetReport(assetReportToken, maxAttempts = 10) {
        let attempts = 0;
        while (attempts < maxAttempts) {
            attempts++;
            try {
                const res = await this.plaid.assetReportGet({ asset_report_token: assetReportToken });
                return res.data;
            }
            catch (err) {
                if (err?.response?.data?.error_code === "PRODUCT_NOT_READY") {
                    const delay = Math.min(1000 * Math.pow(2, attempts), 30000);
                    await new Promise((r) => setTimeout(r, delay));
                    continue;
                }
                throw err;
            }
        }
        throw new PlaidError("Asset report not ready after maximum polling attempts");
    }
    // ─── AES-256-GCM Encryption (for Plaid access tokens) ───────────────────
    encryptAES(plaintext) {
        const key = Buffer.from(process.env.PLAID_TOKEN_ENCRYPTION_KEY, "hex");
        const iv = crypto_1.default.randomBytes(16);
        const cipher = crypto_1.default.createCipheriv("aes-256-gcm", key, iv);
        const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
        const authTag = cipher.getAuthTag();
        return Buffer.concat([iv, authTag, encrypted]).toString("base64");
    }
    decryptAES(encryptedBase64) {
        const key = Buffer.from(process.env.PLAID_TOKEN_ENCRYPTION_KEY, "hex");
        const buf = Buffer.from(encryptedBase64, "base64");
        const iv = buf.slice(0, 16);
        const authTag = buf.slice(16, 32);
        const encrypted = buf.slice(32);
        const decipher = crypto_1.default.createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    }
}
exports.SolvencyService = SolvencyService;
const BALANCE_TIERS = [
    { min: 0, max: 2_000, tier: 'LOW', label: 'Under $2,000' },
    { min: 2_000, max: 5_000, tier: 'LOW', label: '$2,000 – $5,000' },
    { min: 5_000, max: 10_000, tier: 'MEDIUM', label: '$5,000 – $10,000' },
    { min: 10_000, max: 25_000, tier: 'MEDIUM', label: '$10,000 – $25,000' },
    { min: 25_000, max: 50_000, tier: 'HIGH', label: '$25,000 – $50,000' },
    { min: 50_000, max: 100_000, tier: 'HIGH', label: '$50,000 – $100,000' },
    { min: 100_000, max: Infinity, tier: 'VERY_HIGH', label: 'Over $100,000' },
];
/**
 * Returns a range label for the student's verified balance.
 * The exact balance is NEVER exposed — only the tier/range.
 * Landlords see the LoC guarantee amount, not these figures.
 */
async function getMaskedBalance(studentId) {
    // Sum the most recent verified Plaid balances across all connected items
    const result = await Promise.resolve().then(() => __importStar(require('@vecta/database'))).then(({ queryOne }) => queryOne(`SELECT
         COALESCE(SUM(verified_balance_usd), 0)::text AS total_balance,
         MAX(last_successful_update)::text             AS last_updated
       FROM student_plaid_connections
       WHERE student_id = $1 AND status = 'active'`, [studentId]));
    const total = parseFloat(result?.total_balance ?? '0');
    const bucket = BALANCE_TIERS.find((t) => total >= t.min && total < t.max)
        ?? BALANCE_TIERS[BALANCE_TIERS.length - 1];
    return {
        tier: bucket.tier,
        rangeLabel: bucket.label,
        lastUpdated: result?.last_updated ?? new Date().toISOString(),
    };
}
/**
 * Mark a Plaid item as errored when we receive an ITEM error webhook.
 * The student will need to re-link their bank via the Plaid Link flow.
 */
async function handleItemError(itemId) {
    const { query } = await Promise.resolve().then(() => __importStar(require('@vecta/database')));
    const { createLogger } = await Promise.resolve().then(() => __importStar(require('@vecta/logger')));
    const log = createLogger('plaid-item-error');
    await query(`UPDATE student_plaid_connections
     SET status = 'error', updated_at = NOW()
     WHERE item_id = $1`, [itemId]);
    log.warn({ itemId }, 'Plaid item marked as errored — student must re-link');
}
class PlaidError extends Error {
    constructor(message) { super(message); this.name = "PlaidError"; }
}
exports.PlaidError = PlaidError;
//# sourceMappingURL=plaid.service.js.map