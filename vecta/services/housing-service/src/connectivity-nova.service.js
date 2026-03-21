"use strict";
// services/housing-service/src/connectivity.service.ts
// ─── eSIM Go — Connectivity Provisioning ─────────────────────────────────────
// IMEI validation, 5G plan selection, and eSIM profile activation.
// The student's IMEI is used for provisioning but NEVER stored.
Object.defineProperty(exports, "__esModule", { value: true });
exports.novaCreditService = exports.connectivityService = exports.NovaCreditError = exports.NovaCreditService = exports.ESIMError = exports.ConnectivityService = void 0;
const logger_1 = require("@vecta/logger");
const database_1 = require("@vecta/database");
const logger = (0, logger_1.createLogger)("housing-connectivity");
class ConnectivityService {
    db;
    baseUrl;
    apiKey;
    constructor(db) {
        this.db = db;
        this.baseUrl = process.env.ESIM_GO_API_URL ?? "https://api.esim-go.com/v2.3";
        this.apiKey = process.env.ESIM_GO_API_KEY;
        if (!this.apiKey)
            throw new Error("ESIM_GO_API_KEY is required");
    }
    // ─── IMEI Validation ─────────────────────────────────────────────────────
    // Validates IMEI format and checks 5G capability.
    // The IMEI is used here for provisioning ONLY — not stored.
    async validateIMEI(imei) {
        // Luhn algorithm check (standard IMEI validation)
        if (!this.luhnCheck(imei) || imei.length !== 15) {
            return { valid: false, supports5G: false };
        }
        const res = await this.request("GET", `/devices/imei/${imei}`);
        const base = { valid: res.valid, supports5G: res.device?.supports_5g ?? false };
        return {
            ...base,
            ...(res.device?.brand !== undefined ? { deviceBrand: res.device.brand } : {}),
            ...(res.device?.model !== undefined ? { deviceModel: res.device.model } : {}),
        };
        // NOTE: IMEI is not passed further or stored after this check
    }
    // ─── Provision eSIM ──────────────────────────────────────────────────────
    // Provisions a US eSIM profile for the student.
    // IMEI accepted as a parameter but the response object omits it.
    async provisionESIM(params) {
        // Check for existing eSIM
        const existing = await this.db.query("SELECT esim_iccid, us_phone_number FROM students WHERE id = $1", [params.studentId]);
        if (existing.rows[0]?.esim_iccid) {
            throw new ESIMError("Student already has an active eSIM. Contact support to replace.");
        }
        // Validate IMEI first
        const imeiCheck = await this.validateIMEI(params.imei);
        if (!imeiCheck.valid) {
            throw new ESIMError(`Invalid IMEI: ${params.imei.substring(0, 6)}***`);
        }
        // Select plan based on device capability
        const planId = this.selectPlan(params.planPreference, imeiCheck.supports5G);
        // Provision via eSIM Go API
        const profile = await this.request("POST", "/profiles", {
            plan_id: planId,
            imei: params.imei, // Sent to eSIM Go, not stored
            country: "US",
            iccid: null, // Auto-assign
            external_id: `vecta-${params.studentId}`,
        });
        if (profile.status === "failed") {
            throw new ESIMError("eSIM provisioning failed. Please retry or contact support.");
        }
        // Store ICCID and US number — NOT the IMEI
        await this.db.query(`UPDATE students SET
        esim_iccid = $1,
        us_phone_number = $2,
        esim_activated_at = NOW()
      WHERE id = $3`, [profile.iccid, profile.phone_number, params.studentId]);
        logger.info({
            event: "ESIM_ACTIVATED",
            studentId: params.studentId,
            iccid: profile.iccid,
            plan: planId,
            // IMEI deliberately excluded from log
        });
        // Return result WITHOUT imei
        return {
            iccid: profile.iccid,
            activationCode: profile.activation_code,
            usPhoneNumber: profile.phone_number,
            plan: params.planPreference ?? (imeiCheck.supports5G ? "5G_UNLIMITED" : "LTE_5GB"),
            activatedAt: profile.activated_at,
        };
    }
    selectPlan(preference, supports5G) {
        const plans = {
            "5G_UNLIMITED": process.env.ESIM_PLAN_5G_UNLIMITED ?? "",
            "5G_10GB": process.env.ESIM_PLAN_5G_10GB ?? "",
            "LTE_5GB": process.env.ESIM_PLAN_LTE_5GB ?? "",
        };
        if (preference && plans[preference])
            return plans[preference];
        const key = supports5G ? "5G_UNLIMITED" : "LTE_5GB";
        const id = plans[key];
        if (!id)
            throw new ESIMError(`Missing eSIM plan env for ${key}`);
        return id;
    }
    luhnCheck(imei) {
        const digits = imei.split("").map(Number).reverse();
        const sum = digits.reduce((acc, d, i) => {
            if (i % 2 === 1) {
                const doubled = d * 2;
                return acc + (doubled > 9 ? doubled - 9 : doubled);
            }
            return acc + d;
        }, 0);
        return sum % 10 === 0;
    }
    async request(method, path, body) {
        const init = {
            method,
            headers: {
                "X-API-Key": this.apiKey,
                "Content-Type": "application/json",
            },
        };
        if (body !== undefined)
            init.body = JSON.stringify(body);
        const res = await fetch(`${this.baseUrl}${path}`, init);
        if (!res.ok) {
            const err = await res.text();
            throw new ESIMError(`eSIM Go API error: ${res.status} ${err}`);
        }
        return res.json();
    }
}
exports.ConnectivityService = ConnectivityService;
class ESIMError extends Error {
    constructor(message) { super(message); this.name = "ESIMError"; }
}
exports.ESIMError = ESIMError;
class NovaCreditService {
    db;
    baseUrl;
    apiKey;
    constructor(db) {
        this.db = db;
        this.baseUrl = process.env.NOVA_CREDIT_API_URL ?? "https://api.novacredit.com/v1";
        this.apiKey = process.env.NOVA_CREDIT_API_KEY;
        if (!this.apiKey)
            throw new Error("NOVA_CREDIT_API_KEY required");
    }
    async fetchCreditHistory(params) {
        const res = await fetch(`${this.baseUrl}/credit-passports`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                passport_number: params.passportNumber,
                country_code: params.countryOfOrigin,
                first_name: params.firstName,
                last_name: params.lastName,
                date_of_birth: params.dateOfBirth,
                consent_given: true,
                consumer_request_id: `vecta-${params.studentId}-${Date.now()}`,
            }),
        });
        if (!res.ok) {
            const err = await res.text();
            throw new NovaCreditError(`Nova Credit API error: ${res.status} ${err}`);
        }
        const data = await res.json();
        const score = data.passport_credit_score;
        if (score.status === "NOT_FOUND") {
            // Student has no international credit history — assign base building score
            logger.warn({ event: "NOVA_CREDIT_NOT_FOUND", studentId: params.studentId });
            return this.buildDefaultScore(params.studentId);
        }
        if (score.status === "ERROR") {
            throw new NovaCreditError("Nova Credit returned an error status");
        }
        const result = {
            cashScore: score.cash_score,
            originalScore: score.original_score,
            originalScoreRange: score.original_score_range,
            bureauCountry: score.bureau_country,
            bureauName: score.bureau_name,
            reportId: score.report_id,
            fetchedAt: new Date().toISOString(),
            factors: score.factors.map((f) => ({
                code: f.code,
                description: f.description,
                impact: f.positive_impact ? "POSITIVE" : "NEGATIVE",
            })),
        };
        // Persist translated score
        const tier = this.scoreTier(result.cashScore);
        await this.db.query(`UPDATE students SET
        nova_credit_report_id = $1,
        vecta_trust_score = $2,
        trust_score_tier = $3,
        nova_credit_fetched_at = NOW()
      WHERE id = $4`, [result.reportId, result.cashScore, tier, params.studentId]);
        return result;
    }
    buildDefaultScore(studentId) {
        // Assign a minimum "Building" score for students with no history
        return {
            cashScore: 580,
            originalScore: 0,
            originalScoreRange: { min: 0, max: 0 },
            bureauCountry: "N/A",
            bureauName: "No International History",
            reportId: `default-${studentId}`,
            fetchedAt: new Date().toISOString(),
            factors: [{ code: "NO_HISTORY", description: "No international credit history found", impact: "NEUTRAL" }],
        };
    }
    scoreTier(score) {
        if (score >= 750)
            return "EXCELLENT";
        if (score >= 670)
            return "GOOD";
        if (score >= 580)
            return "FAIR";
        return "BUILDING";
    }
    /** Gateway cold-cache hook — full Nova pull uses `fetchCreditHistory` with PII from the KYC pipeline. */
    async fetchInternationalCreditHistory(studentId) {
        logger.info({ studentId }, "Nova cold-cache refresh is a no-op here; use fetchCreditHistory after KYC");
    }
}
exports.NovaCreditService = NovaCreditService;
class NovaCreditError extends Error {
    constructor(msg) { super(msg); this.name = "NovaCreditError"; }
}
exports.NovaCreditError = NovaCreditError;
const _housingPool = (0, database_1.getPool)();
exports.connectivityService = new ConnectivityService(_housingPool);
exports.novaCreditService = new NovaCreditService(_housingPool);
//# sourceMappingURL=connectivity-nova.service.js.map