// services/mobility-service/src/driver-onboarding.service.ts
import { query, queryOne } from '@vecta/database';
import { createLogger, logComplianceEvent } from '@vecta/logger';
import { F1ComplianceError } from './flight-recorder.service';

const logger = createLogger('driver-onboarding');

const AUTHORIZED_WORK_TYPES = ['OPT', 'CPT', 'EAD', 'US_CITIZEN', 'PERMANENT_RESIDENT'];

// Personal insurance is NOT used for ride coverage.
// Vecta MGA issues a TNC policy that covers the driver from ride acceptance (Period 2) through dropoff (Period 3).
// Personal insurance only needs to be valid for the driver's personal driving outside of Vecta rides.

export async function applyAsDriver(
  studentId: string,
  params: {
    workAuthType: string;
    workAuthDocUrl: string;
    workAuthExpiry: string;
    licenseNumberEnc: string;
    licenseState: string;
    licenseExpiry: string;
    licenseDocUrl: string;
    insuranceDocUrl?: string | null;
    insuranceExpiry?: string | null;
    vehicleMake: string;
    vehicleModel: string;
    vehicleYear: number;
    vehicleColor: string;
    vehiclePlate: string;
    vehicleCapacity: number;
  },
): Promise<{ driverProfileId: string }> {
  const student = await queryOne<{ kyc_status: string; visa_type: string | null }>(
    'SELECT kyc_status, visa_type FROM students WHERE id=$1',
    [studentId],
  );

  if (!student || student.kyc_status !== 'APPROVED') {
    throw new Error('KYC verification required before applying as a driver');
  }

  if (!AUTHORIZED_WORK_TYPES.includes(params.workAuthType)) {
    await logComplianceEvent('UNAUTHORIZED_DRIVER_APPLICATION_BLOCKED', studentId, {
      workAuthType: params.workAuthType,
      visaStatus: student.visa_type,
    });

    throw new F1ComplianceError(
      'Driver applications require work authorization. ' +
        'F-1 students without OPT/CPT/EAD cannot be drivers. ' +
        'Consider enrolling your vehicle in the Passive Fleet instead ' +
        'to earn Schedule E passive income.',
    );
  }

  const existing = await queryOne<{ id: string; status: string }>(
    'SELECT id, status FROM driver_profiles WHERE student_id=$1',
    [studentId],
  );

  if (existing) {
    throw new Error(`Driver application already exists with status: ${existing.status}`);
  }

  if (new Date(params.workAuthExpiry) <= new Date()) {
    throw new Error('Work authorization document is expired');
  }
  if (new Date(params.licenseExpiry) <= new Date()) {
    throw new Error('Driver license is expired');
  }
  if (params.insuranceExpiry && new Date(params.insuranceExpiry) <= new Date()) {
    throw new Error('Insurance document is expired');
  }

  const result = await queryOne<{ id: string }>(
    `
    INSERT INTO driver_profiles (
      student_id, work_auth_type, work_auth_doc_url, work_auth_expiry,
      license_number_enc, license_state, license_expiry, license_doc_url,
      insurance_doc_url, insurance_expiry,
      vehicle_make, vehicle_model, vehicle_year, vehicle_color,
      vehicle_plate, vehicle_capacity, status
    ) VALUES ($1,$2,$3,$4::date,$5,$6,$7::date,$8,$9,$10::date,$11,$12,$13,$14,$15,$16,'PENDING_REVIEW')
    RETURNING id
  `,
    [
      studentId,
      params.workAuthType,
      params.workAuthDocUrl,
      params.workAuthExpiry,
      params.licenseNumberEnc,
      params.licenseState,
      params.licenseExpiry,
      params.licenseDocUrl,
      params.insuranceDocUrl ?? null,
      params.insuranceExpiry ?? null,
      params.vehicleMake,
      params.vehicleModel,
      params.vehicleYear,
      params.vehicleColor,
      params.vehiclePlate,
      params.vehicleCapacity,
    ],
  );

  logger.info({ studentId, driverProfileId: result!.id }, 'Driver application submitted');
  return { driverProfileId: result!.id };
}

export async function goOnline(driverId: string, lat: number, lng: number): Promise<void> {
  const driver = await queryOne<{
    status: string;
    work_auth_expiry: string;
    license_expiry: string;
    insurance_expiry: string;
  }>(`SELECT status, work_auth_expiry, license_expiry, insurance_expiry FROM driver_profiles WHERE id=$1`, [driverId]);

  if (!driver || driver.status !== 'APPROVED') {
    throw new Error('Driver account not approved');
  }
  if (new Date(driver.work_auth_expiry) <= new Date()) {
    throw new Error('Work authorization has expired. Please update your documents.');
  }
  if (new Date(driver.license_expiry) <= new Date()) {
    throw new Error('Driver license has expired. Please update your documents.');
  }
  if (driver.insurance_expiry && new Date(driver.insurance_expiry) <= new Date()) {
    throw new Error('Insurance has expired. Please update your documents.');
  }

  await query(
    `
    INSERT INTO driver_locations (driver_id, lat, lng, is_online)
    VALUES ($1, $2, $3, TRUE)
    ON CONFLICT (driver_id) DO UPDATE SET
      lat=EXCLUDED.lat, lng=EXCLUDED.lng, is_online=TRUE, updated_at=NOW()
  `,
    [driverId, lat, lng],
  );

  logger.info({ driverId, lat, lng }, 'Driver went online');
}

export async function goOffline(driverId: string): Promise<void> {
  await query(`UPDATE driver_locations SET is_online=FALSE, updated_at=NOW() WHERE driver_id=$1`, [driverId]);
  logger.info({ driverId }, 'Driver went offline');
}
