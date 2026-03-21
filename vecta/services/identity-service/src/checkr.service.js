"use strict";
/**
 * services/identity-service/src/checkr.service.ts
 *
 * Checkr background check integration — gates landlord TRUSTED tier.
 *
 * Flow:
 *   1. Landlord requests background check → POST /landlord/background-check/initiate
 *   2. Vecta creates a Checkr candidate + orders a "tasker" package
 *   3. Checkr emails the landlord a consent link
 *   4. Landlord completes consent → Checkr runs check
 *   5. Checkr webhook → POST /webhooks/checkr → updates landlord tier
 *
 * Package used: "tasker" — identity verification + criminal check
 * No credit check (not needed for landlord verification).
 *
 * Privacy:
 *   SSN is collected by Checkr directly (never touches Vecta servers).
 *   We only store the Checkr report ID + adjudication status.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.initiateBackgroundCheck = initiateBackgroundCheck;
exports.handleCheckrWebhook = handleCheckrWebhook;
exports.getBackgroundCheckStatus = getBackgroundCheckStatus;
const database_1 = require("@vecta/database");
const logger_1 = require("@vecta/logger");
const email_service_1 = require("./email.service");
const logger = (0, logger_1.createLogger)('checkr-service');
const CHECKR_API_KEY = process.env.CHECKR_API_KEY ?? '';
const CHECKR_BASE_URL = process.env.CHECKR_BASE_URL ?? 'https://api.checkr.com/v1';
const CHECKR_PACKAGE = process.env.CHECKR_PACKAGE ?? 'tasker_pro'; // tasker | tasker_pro
// ---------------------------------------------------------------------------
// Checkr API client
// ---------------------------------------------------------------------------
async function checkrPost(path, body) {
    const res = await fetch(`${CHECKR_BASE_URL}${path}`, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${Buffer.from(CHECKR_API_KEY + ':').toString('base64')}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Checkr ${path} failed: ${res.status} — ${err}`);
    }
    return res.json();
}
async function checkrGet(path) {
    const res = await fetch(`${CHECKR_BASE_URL}${path}`, {
        headers: {
            Authorization: `Basic ${Buffer.from(CHECKR_API_KEY + ':').toString('base64')}`,
        },
    });
    if (!res.ok)
        throw new Error(`Checkr GET ${path} failed: ${res.status}`);
    return res.json();
}
// ---------------------------------------------------------------------------
// Initiate background check for a landlord
// ---------------------------------------------------------------------------
async function initiateBackgroundCheck(landlordId) {
    const landlord = await (0, database_1.queryOne)('SELECT id, email, full_name FROM landlord_profiles WHERE id = $1', [landlordId]);
    if (!landlord)
        throw new Error(`Landlord ${landlordId} not found`);
    // 1. Create Checkr candidate
    const candidate = await checkrPost('/candidates', {
        email: landlord.email,
        first_name: landlord.full_name?.split(' ')[0] ?? '',
        last_name: landlord.full_name?.split(' ').slice(1).join(' ') ?? '',
        // SSN / DOB collected by Checkr via their hosted consent flow
        // We do NOT collect or transmit these fields
    });
    // 2. Create report (background check order)
    const report = await checkrPost('/reports', {
        package: CHECKR_PACKAGE,
        candidate_id: candidate.id,
        // Node: work_locations defaults to nationwide for landlord checks
    });
    // 3. Persist Checkr IDs in DB
    await (0, database_1.query)(`UPDATE landlord_profiles
     SET background_check_provider = 'Checkr',
         background_check_id       = $2,
         background_check_status   = 'PENDING',
         updated_at                = NOW()
     WHERE id = $1`, [landlordId, report.id]);
    logger.info({ landlordId, reportId: report.id, candidateId: candidate.id }, 'Background check initiated');
    return {
        candidateId: candidate.id,
        reportId: report.id,
        consentUrl: report.consent_link ?? `https://apply.checkr.com/consent/${candidate.id}`,
        estimatedDays: 2,
    };
}
async function handleCheckrWebhook(payload) {
    const { type, data } = payload;
    if (!type.startsWith('report.'))
        return; // Only handle report events
    const report = data.object;
    if (report.status !== 'complete') {
        logger.info({ reportId: report.id, status: report.status }, 'Report not yet complete');
        return;
    }
    const adjudication = report.adjudication;
    const newStatus = adjudication === 'engaged' ? 'APPROVED' : 'REJECTED';
    // Update landlord profile
    const updated = await (0, database_1.queryOne)(`UPDATE landlord_profiles
     SET background_check_status = $2,
         updated_at              = NOW()
     WHERE background_check_id = $1
     RETURNING id, email, full_name`, [report.id, newStatus]);
    if (!updated) {
        logger.warn({ reportId: report.id }, 'No landlord found for Checkr report ID');
        return;
    }
    logger.info({ landlordId: updated.id, reportId: report.id, newStatus }, 'Background check completed');
    // Notify landlord if approved → TRUSTED tier unlocked
    if (newStatus === 'APPROVED') {
        const emailTo = { toEmail: updated.email };
        if (updated.full_name)
            emailTo.toName = updated.full_name;
        await (0, email_service_1.sendLandlordUpgradeEmail)(emailTo);
    }
}
// ---------------------------------------------------------------------------
// Get current check status (for polling from portal)
// ---------------------------------------------------------------------------
async function getBackgroundCheckStatus(landlordId) {
    const landlord = await (0, database_1.queryOne)('SELECT background_check_id, background_check_status FROM landlord_profiles WHERE id = $1', [landlordId]);
    if (!landlord?.background_check_id) {
        return { status: 'NOT_STARTED' };
    }
    const status = (landlord.background_check_status ?? 'PENDING');
    if (status === 'PENDING') {
        // Fetch live status from Checkr (for accurate progress)
        try {
            const report = await checkrGet(`/reports/${landlord.background_check_id}`);
            const est = report.estimated_completion_time;
            return est !== undefined
                ? { status: 'PENDING', estimatedCompletion: est }
                : { status: 'PENDING' };
        }
        catch { /* use cached status */ }
    }
    return { status };
}
//# sourceMappingURL=checkr.service.js.map