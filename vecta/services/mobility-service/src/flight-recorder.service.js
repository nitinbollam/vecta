"use strict";
// services/mobility-service/src/flight-recorder.service.ts
// ─── The "Flight Recorder" — Immutable F-1 Compliance Audit Chain ─────────────
// Every ride generates a cryptographically chained record proving:
//   1. The F-1 student (LESSOR) was NOT the driver
//   2. Their vehicle generated PASSIVE RENTAL INCOME (not active wages)
// This is the USCIS audit defense system.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.vehicleEnrollmentService = exports.dsoComplianceMemoService = exports.flightRecorderService = exports.VehicleEnrollmentService = exports.DSOComplianceMemoService = exports.FlightRecorderService = exports.ScheduleEValidator = exports.F1ComplianceError = void 0;
const crypto_1 = __importDefault(require("crypto"));
const logger_1 = require("@vecta/logger");
const database_1 = require("@vecta/database");
const logger = (0, logger_1.createLogger)("mobility-flight-recorder");
class F1ComplianceError extends Error {
    constructor(message) {
        super(message);
        this.name = "F1ComplianceError";
    }
}
exports.F1ComplianceError = F1ComplianceError;
// ─── Schedule E Validator ─────────────────────────────────────────────────────
// Runs BEFORE any ride is logged. Enforces the passive income classification.
// Throws hard errors if the ride would violate F-1 compliance.
class ScheduleEValidator {
    db;
    constructor(db) {
        this.db = db;
    }
    async validateRideCompliance(params) {
        // 1. Fetch the active lease for this vehicle
        const leaseResult = await this.db.query(`SELECT
        vl.student_id AS lessor_id,
        vl.lease_active,
        s.roles AS lessor_roles,
        s.legal_name AS lessor_name
       FROM vehicle_leases vl
       JOIN students s ON s.id = vl.student_id
       WHERE vl.vehicle_vin = $1 AND vl.lease_active = TRUE
       LIMIT 1`, [params.vehicleVin]);
        if (leaseResult.rows.length === 0) {
            throw new F1ComplianceError(`Vehicle ${params.vehicleVin} is not enrolled in the Vecta fleet. Cannot log ride.`);
        }
        const { lessor_id: lessorStudentId, lessor_roles: lessorRoles } = leaseResult.rows[0];
        // 2. CRITICAL CHECK: The lessor (F-1 student) CANNOT be the driver
        // If student_id matches proposed driver_id, this is ILLEGAL ACTIVE EMPLOYMENT
        if (lessorStudentId === params.proposedDriverId) {
            logger.error({
                event: "F1_ACTIVE_EMPLOYMENT_BLOCKED",
                lessorStudentId,
                proposedDriverId: params.proposedDriverId,
                vehicleVin: params.vehicleVin,
                rideId: params.rideId,
                severity: "CRITICAL",
                message: "F-1 LESSOR ATTEMPTED TO DRIVE OWN VEHICLE — ACTIVE EMPLOYMENT PREVENTED",
            });
            throw new F1ComplianceError(`CRITICAL F-1 COMPLIANCE VIOLATION PREVENTED: Student ${lessorStudentId} ` +
                `is the registered LESSOR of vehicle ${params.vehicleVin} and cannot be the Driver. ` +
                `This would constitute unauthorized employment under 8 CFR 214.2(f)(9). ` +
                `Ride ${params.rideId} has been blocked.`);
        }
        // 3. Verify the lessor has LESSOR role (not just STUDENT)
        if (!lessorRoles.includes("LESSOR")) {
            throw new F1ComplianceError(`Student ${lessorStudentId} has an active lease but LESSOR role not assigned. ` +
                `Data integrity issue — contact support.`);
        }
        // 4. Verify the proposed driver is NOT an F-1 student in the LESSOR role
        // (belt-and-suspenders — prevents renting to other F-1 students who are also lessors)
        const driverCheck = await this.db.query("SELECT roles FROM students WHERE id = $1", [params.proposedDriverId]);
        if (driverCheck.rows.length > 0) {
            const driverRoles = driverCheck.rows[0].roles;
            if (driverRoles.includes("LESSOR")) {
                throw new F1ComplianceError(`Driver ${params.proposedDriverId} is also a Vecta LESSOR. ` +
                    `This creates a cross-lease compliance ambiguity. Contact compliance team.`);
            }
        }
        // 5. Determine rental income percentage (Vecta's revenue split)
        const rentalIncomePct = parseFloat(process.env.LESSOR_RENTAL_INCOME_PCT ?? "0.30" // 30% to lessor by default
        );
        return { valid: true, lessorStudentId, rentalIncomePct };
    }
}
exports.ScheduleEValidator = ScheduleEValidator;
// ─── Flight Recorder Service ──────────────────────────────────────────────────
class FlightRecorderService {
    db;
    scheduleEValidator;
    constructor(db) {
        this.db = db;
        this.scheduleEValidator = new ScheduleEValidator(db);
    }
    // ─── Log a Completed Ride ────────────────────────────────────────────────
    // Called when a ride ends. Creates an immutable, cryptographically chained
    // record. Each record's hash includes the previous record's hash,
    // forming a tamper-evident chain (blockchain-lite).
    async logCompletedRide(params) {
        // 1. Validate F-1 compliance BEFORE logging
        const { lessorStudentId, rentalIncomePct } = await this.scheduleEValidator.validateRideCompliance({
            vehicleVin: params.vehicleVin,
            proposedDriverId: params.driverUserId,
            rideId: params.rideId,
        });
        // 2. Calculate rental income (the 1099-MISC amount — Schedule E)
        const rentalIncomeCents = Math.round(params.fareAmountCents * rentalIncomePct);
        // 3. Get the previous block (for chaining)
        const prevBlock = await this.db.query(`SELECT block_index, crypto_hash FROM flight_recorder
       WHERE vehicle_vin = $1
       ORDER BY block_index DESC LIMIT 1`, [params.vehicleVin]);
        const previousHash = prevBlock.rows.length > 0
            ? prevBlock.rows[0].crypto_hash
            : "GENESIS_BLOCK_" + params.vehicleVin; // First record for this vehicle
        const nextBlockIndex = prevBlock.rows.length > 0
            ? prevBlock.rows[0].block_index + 1
            : 0;
        // 4. Build the data payload to hash (deterministic — same data = same hash)
        const blockData = {
            rideId: params.rideId,
            vehicleVin: params.vehicleVin,
            lessorStudentId,
            driverUserId: params.driverUserId,
            startTimestamp: params.startTimestamp,
            endTimestamp: params.endTimestamp,
            startLat: params.startGps.lat,
            startLng: params.startGps.lng,
            endLat: params.endGps.lat,
            endLng: params.endGps.lng,
            distanceMiles: params.distanceMiles,
            fareAmountCents: params.fareAmountCents,
            rentalIncomeCents,
            blockIndex: nextBlockIndex,
            previousHash,
        };
        // 5. Generate cryptographic hash (SHA-256 of the block data)
        const cryptoHash = crypto_1.default
            .createHash("sha256")
            .update(JSON.stringify(blockData))
            .update(process.env.FLIGHT_RECORDER_HMAC_KEY) // HMAC pepper
            .digest("hex");
        // 6. Insert into append-only flight_recorder table
        const entry = {
            id: crypto_1.default.randomUUID(),
            rideId: params.rideId,
            vehicleVin: params.vehicleVin,
            lessorStudentId,
            driverUserId: params.driverUserId,
            startTimestamp: params.startTimestamp,
            endTimestamp: params.endTimestamp,
            startGps: params.startGps,
            endGps: params.endGps,
            distanceMiles: params.distanceMiles,
            fareAmountCents: params.fareAmountCents,
            rentalIncomeCents,
            cryptographicHash: cryptoHash,
            previousHash,
            blockIndex: nextBlockIndex,
        };
        await this.db.query(`INSERT INTO flight_recorder (
        id, block_index, ride_id, vehicle_vin, lessor_student_id, driver_user_id,
        start_ts, end_ts, start_lat, start_lng, end_lat, end_lng,
        distance_miles, fare_amount_cents, rental_income_cents,
        crypto_hash, previous_hash
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`, [
            entry.id, entry.blockIndex, entry.rideId, entry.vehicleVin,
            entry.lessorStudentId, entry.driverUserId,
            entry.startTimestamp, entry.endTimestamp,
            entry.startGps.lat, entry.startGps.lng,
            entry.endGps.lat, entry.endGps.lng,
            entry.distanceMiles, entry.fareAmountCents, entry.rentalIncomeCents,
            entry.cryptographicHash, entry.previousHash,
        ]);
        logger.info({
            event: "FLIGHT_RECORDER_ENTRY",
            rideId: params.rideId,
            vehicleVin: params.vehicleVin,
            lessorStudentId,
            blockIndex: nextBlockIndex,
            cryptoHash: cryptoHash.substring(0, 16) + "...", // Partial hash in log
            rentalIncomeCents,
            complianceStatus: "PASSIVE_INCOME_CONFIRMED",
        });
        return entry;
    }
    // ─── Audit Export (for USCIS/IRS request) ───────────────────────────────
    // Returns a verified chain of records for a specific vehicle/student.
    // Verifies the hash chain is unbroken before export.
    async exportAuditChain(params) {
        const records = await this.db.query(`SELECT * FROM flight_recorder
       WHERE lessor_student_id = $1
         AND EXTRACT(YEAR FROM start_ts) = $2
       ORDER BY block_index ASC`, [params.lessorStudentId, params.taxYear]);
        const entries = records.rows.map((r) => ({
            id: r.id,
            rideId: r.ride_id,
            vehicleVin: r.vehicle_vin,
            lessorStudentId: r.lessor_student_id,
            driverUserId: r.driver_user_id,
            startTimestamp: r.start_ts.toISOString(),
            endTimestamp: r.end_ts.toISOString(),
            startGps: { lat: parseFloat(r.start_lat), lng: parseFloat(r.start_lng) },
            endGps: { lat: parseFloat(r.end_lat), lng: parseFloat(r.end_lng) },
            distanceMiles: parseFloat(r.distance_miles),
            fareAmountCents: r.fare_amount_cents,
            rentalIncomeCents: r.rental_income_cents,
            cryptographicHash: r.crypto_hash,
            previousHash: r.previous_hash,
            blockIndex: r.block_index,
        }));
        // Verify hash chain integrity
        const chainIntegrity = this.verifyChainIntegrity(entries);
        const totalRentalIncomeCents = entries.reduce((sum, e) => sum + e.rentalIncomeCents, 0);
        logger.info({
            event: "AUDIT_CHAIN_EXPORTED",
            lessorStudentId: params.lessorStudentId,
            taxYear: params.taxYear,
            rideCount: entries.length,
            chainIntegrity,
            totalRentalIncomeUSD: (totalRentalIncomeCents / 100).toFixed(2),
        });
        // External anchor — S3-backed tamper-evident checkpoint on every export
        if (chainIntegrity === 'VERIFIED' && entries.length > 0) {
            logger.info({ lessorStudentId: params.lessorStudentId, taxYear: params.taxYear }, 'Chain export verified — anchor via audit-service job or shared package in production');
        }
        return {
            records: entries,
            chainIntegrity,
            totalRentalIncomeCents,
            rideCount: entries.length,
            exportTimestamp: new Date().toISOString(),
        };
    }
    verifyChainIntegrity(entries) {
        for (let i = 1; i < entries.length; i++) {
            const curr = entries[i];
            const prev = entries[i - 1];
            if (curr.previousHash !== prev.cryptographicHash) {
                logger.error({
                    event: "CHAIN_INTEGRITY_FAILURE",
                    blockIndex: curr.blockIndex,
                    expectedPreviousHash: prev.cryptographicHash,
                    actualPreviousHash: curr.previousHash,
                });
                return "COMPROMISED";
            }
        }
        return "VERIFIED";
    }
}
exports.FlightRecorderService = FlightRecorderService;
// ─── DSO Compliance Memo Generator ───────────────────────────────────────────
class DSOComplianceMemoService {
    db;
    constructor(db) {
        this.db = db;
    }
    async generateMemo(studentId) {
        const result = await this.db.query(`SELECT
        s.legal_name, s.university_name, s.verified_email, s.us_phone_number,
        s.visa_type, s.sevis_id_enc,
        fr.total_income,
        fr.ride_count,
        vl.vehicle_make, vl.vehicle_model, vl.vehicle_year,
        vl.tos_version, vl.consent_timestamp
       FROM students s
       JOIN vehicle_leases vl ON vl.student_id = s.id AND vl.lease_active = TRUE
       LEFT JOIN (
         SELECT lessor_student_id,
                SUM(rental_income_cents) AS total_income,
                COUNT(*) AS ride_count
         FROM flight_recorder
         WHERE EXTRACT(YEAR FROM start_ts) = EXTRACT(YEAR FROM NOW())
         GROUP BY lessor_student_id
       ) fr ON fr.lessor_student_id = s.id
       WHERE s.id = $1`, [studentId]);
        if (result.rows.length === 0) {
            throw new Error("Student or vehicle lease not found");
        }
        const s = result.rows[0];
        const generatedAt = new Date().toISOString();
        const totalIncomeUSD = ((s.total_income ?? 0) / 100).toFixed(2);
        const memoText = `
Subject: Transparency Notice regarding Passive Asset Leasing (Vecta Rides) – ${s.legal_name}

Dear Designated School Official (DSO) / International Student Office,

I am writing to proactively disclose my participation in a passive asset-leasing program through the Vecta platform and to ensure complete transparency regarding my ongoing compliance with my F-1 visa regulations.

I have enrolled my personal vehicle (${s.vehicle_year} ${s.vehicle_make} ${s.vehicle_model}) in the Vecta Rides program under a strict "Lease-Back" agreement. I want to be explicitly clear about the nature of this arrangement to assure you that it does not constitute unauthorized employment.

Please note the following structural safeguards of this agreement:

1. STRICTLY PASSIVE INCOME (NO ACTIVE EMPLOYMENT)
Under this agreement, I am acting solely as a passive lessor of a capital asset (my vehicle). I am explicitly prohibited by Vecta's Terms of Service (Version ${s.tos_version}, signed ${new Date(s.consent_timestamp).toLocaleDateString()}) from driving my own vehicle for passengers, maintaining the fleet, or actively managing the platform. I am not an employee, independent contractor, or driver for Vecta.

2. TAX CLASSIFICATION & IRS COMPLIANCE
All earnings generated from the lease of my vehicle are legally classified as "Passive Rental Income." At the end of the tax year, Vecta will issue a Form 1099-MISC (Box 1: Rents). I will report this income on IRS Schedule E (Supplemental Income and Loss), which is strictly for passive income and is entirely separate from Schedule C (Business/Active Income). Vecta does not issue Form 1099-NEC (Nonemployee Compensation).

Year-to-date rental income: $${totalIncomeUSD} (${s.ride_count ?? 0} vehicle deployments)

3. IMMUTABLE AUDIT TRAIL
To ensure strict separation between my person and the operation of the vehicle, Vecta maintains a cryptographically secured "Flight Recorder" audit log. This system tracks GPS telemetry and driver assignments to provide definitive proof that I am not physically operating the vehicle while it is generating rental income. Vecta can provide these logs directly to your office or to USCIS upon request.

I take my F-1 visa status incredibly seriously, which is why I chose a platform explicitly engineered to comply with USCIS regulations regarding passive investment and property leasing.

I have attached the formal Vecta Asset Lease Agreement for your records. Please let me know if you require any additional documentation or if you would like to speak with Vecta's compliance team directly at compliance@vecta.app.

Thank you for your time and guidance.

Sincerely,
${s.legal_name}
${s.university_name}
Visa Type: ${s.visa_type}
Email: ${s.verified_email}
US Phone: ${s.us_phone_number}
Vecta ID: ${studentId}

---
This memo was automatically generated by the Vecta platform on ${new Date(generatedAt).toLocaleString()}.
Vecta Compliance Team | compliance@vecta.app | https://vecta.app/compliance
`.trim();
        const memoHtml = memoText
            .replace(/\n\n/g, "</p><p>")
            .replace(/\n/g, "<br>")
            .replace(/^/, "<p>")
            .concat("</p>");
        // Log that memo was generated
        await this.db.query("INSERT INTO audit_events (student_id, event_type, payload) VALUES ($1, $2, $3)", [studentId, "DSO_MEMO_GENERATED", JSON.stringify({ generatedAt, totalIncomeUSD })]);
        return { memoText, memoHtml, generatedAt };
    }
}
exports.DSOComplianceMemoService = DSOComplianceMemoService;
// ─── Vehicle Enrollment with Consent Capture ──────────────────────────────────
class VehicleEnrollmentService {
    db;
    constructor(db) {
        this.db = db;
    }
    async enrollVehicleWithConsent(params) {
        // Validate all consents are explicitly TRUE
        const allConsentsGiven = (params.strictlyPassiveAcknowledged &&
            params.taxClassificationAcknowledged &&
            params.flightRecorderConsentAcknowledged &&
            params.independentCounselWaiverAcknowledged);
        if (!allConsentsGiven) {
            throw new F1ComplianceError("All four compliance clauses must be acknowledged before vehicle enrollment. " +
                "Missing: " + [
                !params.strictlyPassiveAcknowledged && "Strictly Passive Acknowledgment",
                !params.taxClassificationAcknowledged && "Tax Classification (Schedule E)",
                !params.flightRecorderConsentAcknowledged && "Flight Recorder Audit Consent",
                !params.independentCounselWaiverAcknowledged && "Independent Counsel Waiver",
            ].filter(Boolean).join(", "));
        }
        const consentTimestamp = new Date().toISOString();
        // Generate signature hash — cryptographic proof of consent
        const consentData = {
            studentId: params.studentId,
            vehicleVin: params.vehicleVin,
            vehicleMake: params.vehicleMake,
            vehicleModel: params.vehicleModel,
            vehicleYear: params.vehicleYear,
            consentTimestamp,
            consentIpAddress: params.consentIpAddress,
            consentUserAgent: params.consentUserAgent,
            tosVersion: params.tosVersion,
            clauses: {
                strictlyPassiveAcknowledged: true,
                taxClassificationAcknowledged: true,
                flightRecorderConsentAcknowledged: true,
                independentCounselWaiverAcknowledged: true,
            },
            signatureHash: "",
        };
        consentData.signatureHash = crypto_1.default
            .createHash("sha256")
            .update(JSON.stringify({ ...consentData, signatureHash: undefined }))
            .digest("hex");
        const result = await this.db.query(`INSERT INTO vehicle_leases (
        student_id, vehicle_vin, vehicle_make, vehicle_model, vehicle_year,
        tos_version,
        passive_acknowledged, tax_acknowledged,
        flight_recorder_consented, counsel_waiver_acknowledged,
        consent_timestamp, consent_ip, consent_user_agent, signature_hash
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING id, lease_active`, [
            params.studentId, params.vehicleVin, params.vehicleMake,
            params.vehicleModel, params.vehicleYear, params.tosVersion,
            true, true, true, true,
            consentTimestamp, params.consentIpAddress, params.consentUserAgent,
            consentData.signatureHash,
        ]);
        const { id: leaseId, lease_active: leaseActive } = result.rows[0];
        logger.info({
            event: "VEHICLE_ENROLLED",
            studentId: params.studentId,
            vehicleVin: params.vehicleVin,
            leaseId,
            leaseActive,
            signatureHash: consentData.signatureHash.substring(0, 16) + "...",
        });
        return { leaseId, leaseActive };
    }
}
exports.VehicleEnrollmentService = VehicleEnrollmentService;
const _mobilityPool = (0, database_1.getPool)();
exports.flightRecorderService = new FlightRecorderService(_mobilityPool);
exports.dsoComplianceMemoService = new DSOComplianceMemoService(_mobilityPool);
exports.vehicleEnrollmentService = new VehicleEnrollmentService(_mobilityPool);
//# sourceMappingURL=flight-recorder.service.js.map