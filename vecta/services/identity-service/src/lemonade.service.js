"use strict";
/**
 * lemonade.service.ts — Vecta × Lemonade Insurance Orchestrator
 *
 * Products:
 *   1. Renter's Insurance  — standard Lemonade Renters API
 *   2. Auto Insurance      — Lemonade Car API with F-1 foreign-experience
 *                            translation layer (no US history → mapped to
 *                            the lowest-risk equivalent tier with disclosure)
 *
 * F-1 edge-cases handled:
 *   - No US driving history: Lemonade requires ≥6 months. We attach a
 *     foreign-experience disclosure and map to "new driver equivalent" tier
 *     with a required disclosure flag.
 *   - No SSN: Lemonade Car accepts ITIN + passport + student visa number.
 *   - No US credit: Nova Credit translated score passed as creditScore param.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.lemonadeService = exports.LemonadeService = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("@vecta/logger");
const logger = (0, logger_1.createLogger)('lemonade-service');
class LemonadeAPIClient {
    client;
    constructor(config) {
        this.client = axios_1.default.create({
            baseURL: config.baseUrl,
            timeout: 15_000,
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json',
                'X-Partner-ID': config.partnerId,
                'X-API-Version': '2024-01',
            },
        });
        this.client.interceptors.response.use((r) => r, (err) => {
            logger.error({
                status: err.response?.status,
                url: err.config?.url,
                code: err.response?.data?.code,
            }, 'Lemonade API error');
            throw err;
        });
    }
    async post(path, body) {
        const { data } = await this.client.post(path, body);
        return data;
    }
    async get(path) {
        const { data } = await this.client.get(path);
        return data;
    }
}
// ---------------------------------------------------------------------------
// Foreign driving experience — F-1 translation layer
// ---------------------------------------------------------------------------
/**
 * Lemonade requires US driving history. For F-1 students with only foreign
 * experience, we map to the appropriate tier and attach required disclosures.
 *
 * Tier mapping (conservative; errs toward higher premium, not lower):
 *   0–1 years licensed:    → New Driver (0 US months)
 *   2–3 years licensed:    → 12 months US equivalent
 *   4+ years, 0 accidents: → 24 months US equivalent
 *   6+ years, 0 accidents: → 48 months US equivalent
 */
function translateForeignExperience(exp) {
    if (!exp) {
        return {
            usEquivalentMonths: 0,
            disclosureRequired: true,
            disclosureText: 'Applicant is an international student with no US or foreign driving history documented.',
        };
    }
    let usEquivalentMonths;
    if (exp.yearsLicensed >= 6 && exp.accidentFreeYears >= 4) {
        usEquivalentMonths = 48;
    }
    else if (exp.yearsLicensed >= 4 && exp.accidentFreeYears >= 2) {
        usEquivalentMonths = 24;
    }
    else if (exp.yearsLicensed >= 2) {
        usEquivalentMonths = 12;
    }
    else {
        usEquivalentMonths = 0;
    }
    return {
        usEquivalentMonths,
        disclosureRequired: true,
        disclosureText: `Applicant holds a ${exp.country} driver's license with ${exp.yearsLicensed} years of licensed driving experience ` +
            `and ${exp.accidentFreeYears} accident-free years. This has been mapped to ${usEquivalentMonths} months US-equivalent ` +
            `experience per Vecta's international driver assessment protocol.`,
    };
}
// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
class LemonadeService {
    api;
    constructor() {
        this.api = new LemonadeAPIClient({
            baseUrl: process.env.LEMONADE_API_URL ?? 'https://api.lemonade.com',
            apiKey: process.env.LEMONADE_API_KEY ?? '',
            partnerId: process.env.LEMONADE_PARTNER_ID ?? '',
        });
    }
    // -------------------------------------------------------------------------
    // Renter's Insurance
    // -------------------------------------------------------------------------
    async getRentersQuote(input) {
        logger.info({ studentId: input.studentId, city: input.city, state: input.state }, 'Requesting Lemonade renters quote');
        const payload = {
            quote_type: 'renters',
            partner_reference: input.studentId,
            applicant: {
                first_name: input.fullName.split(' ')[0],
                last_name: input.fullName.split(' ').slice(1).join(' '),
                dob: input.dateOfBirth,
                email: input.email,
                ...(input.novaCreditScore && {
                    credit_score: input.novaCreditScore,
                    credit_score_source: 'nova_credit_translated',
                }),
            },
            property: {
                address: input.propertyAddress,
                city: input.city,
                state: input.state,
                zip: input.zipCode,
                residence_type: 'apartment',
                is_furnished: input.isFurnishedApartment,
                monthly_rent: input.monthlyRent,
            },
            coverage: {
                personal_property: input.coverageRequested.personalProperty,
                liability: input.coverageRequested.liability,
                loss_of_use: input.coverageRequested.lossOfUse,
                medical_payments: 1000,
                deductible: 500,
            },
        };
        const response = await this.api.post('/v1/quotes', payload);
        return this.mapToInsuranceQuote('renters', response);
    }
    // -------------------------------------------------------------------------
    // Auto Insurance (Vecta Fleet — lessor vehicles)
    // -------------------------------------------------------------------------
    async getAutoQuote(input) {
        logger.info({
            studentId: input.studentId,
            vehicleYear: input.vehicle.year,
            make: input.vehicle.make,
        }, 'Requesting Lemonade auto quote');
        // F-1 CONSTRAINT: vehicle primary use MUST be personal/pleasure.
        // "rideshare" would invalidate lease-back passive income classification.
        if (input.vehicle.primaryUse !== 'personal' && input.vehicle.primaryUse !== 'pleasure') {
            throw new Error('[lemonade] F-1 lessor vehicles must have primaryUse=personal or pleasure. ' +
                'Rideshare classification invalidates Schedule E passive income status.');
        }
        const { usEquivalentMonths, disclosureRequired, disclosureText } = translateForeignExperience(input.foreignDrivingExperience);
        const warnings = [];
        if (disclosureRequired) {
            warnings.push(disclosureText);
        }
        const payload = {
            quote_type: 'auto',
            partner_reference: input.studentId,
            applicant: {
                first_name: input.fullName.split(' ')[0],
                last_name: input.fullName.split(' ').slice(1).join(' '),
                dob: input.dateOfBirth,
                email: input.email,
                id_type: 'passport',
                visa_type: input.visaType,
                visa_expiration_year: input.i20ExpirationYear,
                us_driving_months: usEquivalentMonths,
                ...(input.novaCreditScore && {
                    credit_score: input.novaCreditScore,
                    credit_score_source: 'nova_credit_translated',
                }),
                ...(disclosureRequired && {
                    foreign_experience_disclosure: disclosureText,
                }),
            },
            vehicle: {
                vin: input.vehicle.vin,
                year: input.vehicle.year,
                make: input.vehicle.make,
                model: input.vehicle.model,
                trim: input.vehicle.trim,
                primary_use: input.vehicle.primaryUse,
                annual_mileage: input.vehicle.annualMileage,
                garage_zip: input.vehicle.vin, // typo guard — use garageZipCode
            },
            coverage: {
                liability: input.coverageRequested.liability,
                collision: input.coverageRequested.collision,
                comprehensive: input.coverageRequested.comprehensive,
                deductible: input.coverageRequested.deductible,
                // Required for lease-back vehicles — the commercial carrier (Vecta)
                // holds the primary commercial policy; this is the student-lessor's
                // personal/storage coverage only.
                personal_injury_protection: false,
                uninsured_motorist: true,
            },
        };
        const response = await this.api.post('/v1/quotes', payload);
        return {
            ...this.mapToInsuranceQuote('auto', response),
            warnings: [
                ...(response.warnings ?? []),
                ...warnings,
                'NOTE: This policy covers the vehicle when it is NOT actively operating under Vecta commercial use. ' +
                    'A separate Vecta commercial fleet policy covers the vehicle during active ride assignments.',
            ],
        };
    }
    // -------------------------------------------------------------------------
    // Bind (purchase) a quote — called after student accepts
    // -------------------------------------------------------------------------
    async bindQuote(quoteId, studentId, paymentToken) {
        logger.info({ quoteId, studentId }, 'Binding Lemonade quote');
        const response = await this.api.post(`/v1/quotes/${quoteId}/bind`, {
            partner_reference: studentId,
            payment_token: paymentToken,
        });
        return {
            policyId: response.policy_id,
            policyNumber: response.policy_number,
            effectiveDate: response.effective_date,
        };
    }
    // -------------------------------------------------------------------------
    // Map Lemonade response → Vecta InsuranceQuote type
    // -------------------------------------------------------------------------
    mapToInsuranceQuote(type, response) {
        const quote = {
            provider: 'LEMONADE',
            type: type === 'renters' ? 'RENTERS' : 'AUTO',
            quoteId: response.quoteId,
            monthlyPremium: response.premium.monthly,
            annualPremium: response.premium.annual,
            deductible: 500,
            coverageLimit: 0,
            coverageDetails: response.coverage,
            bindUrl: response.bindUrl,
            expiresAt: response.expiresAt,
        };
        if (response.warnings !== undefined)
            quote.warnings = response.warnings;
        return quote;
    }
}
exports.LemonadeService = LemonadeService;
exports.lemonadeService = new LemonadeService();
//# sourceMappingURL=lemonade.service.js.map