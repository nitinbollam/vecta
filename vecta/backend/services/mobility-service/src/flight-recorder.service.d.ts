import { Pool } from "pg";
import type { FlightRecorderEntry } from "@vecta/types";
export declare class F1ComplianceError extends Error {
    constructor(message: string);
}
export declare class ScheduleEValidator {
    private readonly db;
    constructor(db: Pool);
    validateRideCompliance(params: {
        vehicleVin: string;
        proposedDriverId: string;
        rideId: string;
    }): Promise<{
        valid: true;
        lessorStudentId: string;
        rentalIncomePct: number;
    }>;
}
export declare class FlightRecorderService {
    private readonly db;
    private readonly scheduleEValidator;
    constructor(db: Pool);
    logCompletedRide(params: {
        rideId: string;
        vehicleVin: string;
        driverUserId: string;
        startTimestamp: string;
        endTimestamp: string;
        startGps: {
            lat: number;
            lng: number;
        };
        endGps: {
            lat: number;
            lng: number;
        };
        distanceMiles: number;
        fareAmountCents: number;
    }): Promise<FlightRecorderEntry>;
    exportAuditChain(params: {
        lessorStudentId: string;
        taxYear: number;
    }): Promise<{
        records: FlightRecorderEntry[];
        chainIntegrity: "VERIFIED" | "COMPROMISED";
        totalRentalIncomeCents: number;
        rideCount: number;
        exportTimestamp: string;
    }>;
    private verifyChainIntegrity;
}
export declare class DSOComplianceMemoService {
    private readonly db;
    constructor(db: Pool);
    generateMemo(studentId: string): Promise<{
        memoText: string;
        memoHtml: string;
        generatedAt: string;
    }>;
}
export declare class VehicleEnrollmentService {
    private readonly db;
    constructor(db: Pool);
    enrollVehicleWithConsent(params: {
        studentId: string;
        vehicleVin: string;
        vehicleMake: string;
        vehicleModel: string;
        vehicleYear: number;
        strictlyPassiveAcknowledged: boolean;
        taxClassificationAcknowledged: boolean;
        flightRecorderConsentAcknowledged: boolean;
        independentCounselWaiverAcknowledged: boolean;
        consentIpAddress: string;
        consentUserAgent: string;
        tosVersion: string;
    }): Promise<{
        leaseId: string;
        leaseActive: boolean;
    }>;
}
export declare const flightRecorderService: FlightRecorderService;
export declare const dsoComplianceMemoService: DSOComplianceMemoService;
export declare const vehicleEnrollmentService: VehicleEnrollmentService;
//# sourceMappingURL=flight-recorder.service.d.ts.map