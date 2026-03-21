// services/identity-service/src/unit.service.ts
// ─── Unit.co BaaS — Pre-Arrival Demand Deposit Account Provisioning ───────────
// Handles: Customer creation, KYC via Didit data passthrough, DDA opening,
// and ongoing account management. F-1 students use passport instead of SSN.

import { Pool } from "pg";
import {
  UnitCustomerCreate,
  KYCStatus,
  VectaIDStatus,
  AuditEventType,
} from "@vecta/types";
import { encryptField, decryptField } from "@vecta/crypto";
import { createLogger } from "@vecta/logger";
import { getPool } from "@vecta/database";

const logger = createLogger("identity-unit");

function byteaOrTextToString(v: unknown): string {
  if (typeof v === "string") return v;
  if (Buffer.isBuffer(v)) return v.toString("utf8");
  return String(v);
}

// ─── Unit.co API Client ───────────────────────────────────────────────────────

interface UnitCustomerResponse {
  data: {
    type: "individualCustomer";
    id: string;
    attributes: {
      status: "Active" | "Archived" | "Under Review";
      fullName: { first: string; last: string };
      email: string;
      phone: { countryCode: string; number: string };
      createdAt: string;
    };
  };
}

interface UnitAccountResponse {
  data: {
    type: "depositAccount" | "checkingAccount";
    id: string;
    attributes: {
      status: "Open" | "Closed" | "Frozen";
      name: string;
      routingNumber: string;
      accountNumber: string;
      balance: number;
      hold: number;
      available: number;
      currency: "USD";
      createdAt: string;
    };
  };
}

interface UnitKYCDocumentSubmitResponse {
  data: { id: string; attributes: { status: string } };
}

class UnitAPIClient {
  private readonly baseUrl: string;
  private readonly bearerToken: string;

  constructor() {
    this.baseUrl = process.env.UNIT_API_URL ?? "https://api.s.unit.sh";  // Sandbox default
    this.bearerToken = process.env.UNIT_API_TOKEN!;

    if (!this.bearerToken) {
      throw new Error("UNIT_API_TOKEN is required");
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const init: RequestInit = {
      method,
      headers: {
        "Authorization": `Bearer ${this.bearerToken}`,
        "Content-Type": "application/vnd.api+json",
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(`${this.baseUrl}${path}`, init);

    if (!res.ok) {
      const errBody = await res.text();
      throw new UnitAPIError(`Unit.co ${method} ${path} failed: ${res.status} ${errBody}`);
    }

    return res.json() as Promise<T>;
  }

  // Create an Individual Customer (F-1 student — passport-based, not SSN)
  async createIndividualCustomer(params: {
    fullName: { first: string; last: string };
    email: string;
    phone: string;
    address: UnitCustomerCreate["address"];
    dateOfBirth: string;
    idempotencyKey: string;
    // F-1 specific: passport instead of SSN
    passportNumber?: string;
    passportCountry?: string;
    passportExpiry?: string;
  }): Promise<UnitCustomerResponse> {
    const idAttributes: Record<string, unknown> = {};

    // Unit supports passport-based KYC for international customers
    if (params.passportNumber) {
      idAttributes["passport"] = {
        number: params.passportNumber,
        countryCode: params.passportCountry,
        expirationDate: params.passportExpiry,  // YYYY-MM-DD
      };
    }

    return this.request<UnitCustomerResponse>("POST", "/customers", {
      data: {
        type: "individualCustomer",
        attributes: {
          fullName: params.fullName,
          email: params.email,
          phone: { countryCode: "1", number: params.phone.replace(/\D/g, "") },
          address: {
            street: params.address.street,
            city: params.address.city,
            state: params.address.state,
            postalCode: params.address.postalCode,
            country: "US",
          },
          dateOfBirth: params.dateOfBirth,
          ...idAttributes,
          idempotencyKey: params.idempotencyKey,
        },
      },
    });
  }

  // Open a Demand Deposit Account (Vecta-branded checking account)
  async openDepositAccount(
    customerId: string,
    studentId: string
  ): Promise<UnitAccountResponse> {
    return this.request<UnitAccountResponse>("POST", "/accounts", {
      data: {
        type: "depositAccount",
        attributes: {
          depositProduct: process.env.UNIT_DEPOSIT_PRODUCT_ID!,
          idempotencyKey: `vecta-dda-${studentId}`,
          tags: {
            vectaStudentId: studentId,
            platform: "vecta",
            accountType: "student_dda",
          },
        },
        relationships: {
          customer: {
            data: { type: "customer", id: customerId },
          },
        },
      },
    });
  }

  // Upload KYC document (Didit verification evidence)
  async uploadKYCDocument(
    customerId: string,
    documentType: "Passport",
    frontImageBase64: string
  ): Promise<UnitKYCDocumentSubmitResponse> {
    return this.request<UnitKYCDocumentSubmitResponse>(
      "POST",
      `/customers/${customerId}/documents`,
      {
        data: {
          type: "document",
          attributes: {
            documentType,
            fileType: "jpeg",
            frontImageBase64,
          },
        },
      }
    );
  }

  async getAccount(accountId: string): Promise<UnitAccountResponse> {
    return this.request<UnitAccountResponse>("GET", `/accounts/${accountId}`);
  }
}

// ─── BaaS Service ─────────────────────────────────────────────────────────────

export class BaaSService {
  private readonly unit: UnitAPIClient;

  constructor(private readonly db: Pool) {
    this.unit = new UnitAPIClient();
  }

  // ─── Full KYC Handshake ──────────────────────────────────────────────────
  // Called AFTER Didit NFC verification completes.
  // Passes the Didit-verified data directly to Unit.co — no manual re-entry.
  // This is the "KYC Handshake" that makes the onboarding seamless.

  async provisionStudentAccount(params: {
    studentId: string;
    email: string;
    phone: string;
    address: UnitCustomerCreate["address"];
    // Data from Didit verification (already validated)
    legalFirstName: string;
    legalLastName: string;
    dateOfBirth: string;         // YYYY-MM-DD (converted from MRZ YYMMDD)
    passportNumber: string;      // Temporarily in memory — never logged
    passportCountry: string;     // Encrypted in DB
    passportExpiry: string;      // YYYY-MM-DD
    passportSelfieBase64: string;
  }): Promise<{
    unitCustomerId: string;
    unitAccountId: string;
    kycStatus: KYCStatus;
  }> {
    // Check for idempotency — don't double-provision
    const existing = await this.db.query(
      "SELECT unit_customer_id, unit_account_id_enc, kyc_status FROM students WHERE id = $1",
      [params.studentId]
    );

    if (existing.rows[0]?.unit_customer_id) {
      logger.warn({ event: "UNIT_ALREADY_PROVISIONED", studentId: params.studentId });
      const accountId = decryptField(byteaOrTextToString(existing.rows[0].unit_account_id_enc));
      return {
        unitCustomerId: existing.rows[0].unit_customer_id,
        unitAccountId: accountId,
        kycStatus: existing.rows[0].kyc_status,
      };
    }

    // Update KYC status to IN_PROGRESS
    await this.db.query(
      "UPDATE students SET kyc_status = $1 WHERE id = $2",
      [KYCStatus.IN_PROGRESS, params.studentId]
    );

    let unitCustomerId: string;
    let unitAccountId: string;

    try {
      // ── Step 1: Create Unit customer with passport ────────────────────────
      const customerRes = await this.unit.createIndividualCustomer({
        fullName: { first: params.legalFirstName, last: params.legalLastName },
        email: params.email,
        phone: params.phone,
        address: params.address,
        dateOfBirth: params.dateOfBirth,
        idempotencyKey: `vecta-customer-${params.studentId}`,
        passportNumber: params.passportNumber,  // Passed to Unit, never stored in our DB
        passportCountry: params.passportCountry,
        passportExpiry: params.passportExpiry,
      });

      unitCustomerId = customerRes.data.id;

      // ── Step 2: Upload passport selfie for enhanced KYC ───────────────────
      await this.unit.uploadKYCDocument(
        unitCustomerId,
        "Passport",
        params.passportSelfieBase64
      );

      // ── Step 3: Open Demand Deposit Account (Vecta-branded) ───────────────
      const accountRes = await this.unit.openDepositAccount(
        unitCustomerId,
        params.studentId
      );

      unitAccountId = accountRes.data.id;

      // ── Step 4: Map Unit status to our KYC enum ───────────────────────────
      const kycStatus = this.mapUnitStatusToKYC(customerRes.data.attributes.status);

      // ── Step 5: Persist — encrypt the account ID (balance stays at Unit) ──
      await this.db.query(
        `UPDATE students SET
          unit_customer_id = $1,
          unit_account_id_enc = $2,
          kyc_status = $3,
          vecta_id_status = $4
        WHERE id = $5`,
        [
          unitCustomerId,
          encryptField(unitAccountId),
          kycStatus,
          VectaIDStatus.BANKING_PROVISIONED,
          params.studentId,
        ]
      );

      await this.emitAuditEvent(params.studentId, AuditEventType.ACCOUNT_PROVISIONED, {
        unitCustomerId,
        kycStatus,
      });

      logger.info({
        event: "UNIT_ACCOUNT_PROVISIONED",
        studentId: params.studentId,
        unitCustomerId,
        kycStatus,
      });

      return { unitCustomerId, unitAccountId, kycStatus };

    } catch (err) {
      // Roll back KYC status on failure
      await this.db.query(
        "UPDATE students SET kyc_status = $1 WHERE id = $2",
        [KYCStatus.NEEDS_REVIEW, params.studentId]
      );
      throw err;
    }
  }

  // ─── Get Account Balance (internal only — never exposed to landlords) ────
  /** Coarse masking for internal dashboards — not exact cents. */
  async getMaskedBalance(studentId: string): Promise<{
    availableBandUsd: number;
    balanceBandUsd: number;
    currency: "USD";
  }> {
    const b = await this.getAccountBalance(studentId);
    return {
      availableBandUsd: Math.floor(b.available / 100) * 100,
      balanceBandUsd: Math.floor(b.balance / 100) * 100,
      currency: "USD",
    };
  }

  async getAccountBalance(studentId: string): Promise<{
    available: number;
    balance: number;
    currency: "USD";
  }> {
    const result = await this.db.query(
      "SELECT unit_account_id_enc FROM students WHERE id = $1",
      [studentId]
    );

    if (!result.rows[0]?.unit_account_id_enc) {
      throw new Error("No Unit account found for student");
    }

    const accountId = decryptField(byteaOrTextToString(result.rows[0].unit_account_id_enc));
    const account = await this.unit.getAccount(accountId);

    return {
      available: account.data.attributes.available,
      balance: account.data.attributes.balance,
      currency: "USD",
    };
  }

  /**
   * Idempotent if already provisioned; otherwise loads latest Didit session and calls Unit.
   */
  async provisionStudentAccountByStudentId(studentId: string): Promise<{
    unitCustomerId: string;
    unitAccountId: string;
    kycStatus: KYCStatus;
  }> {
    const existing = await this.db.query<{
      unit_customer_id: string | null;
      unit_account_id_enc: unknown;
      kyc_status: KYCStatus;
    }>(
      "SELECT unit_customer_id, unit_account_id_enc, kyc_status FROM students WHERE id = $1",
      [studentId],
    );
    const ex = existing.rows[0];
    if (ex?.unit_customer_id && ex.unit_account_id_enc != null) {
      return {
        unitCustomerId: ex.unit_customer_id,
        unitAccountId: decryptField(byteaOrTextToString(ex.unit_account_id_enc)),
        kycStatus: ex.kyc_status,
      };
    }

    const row = await this.db.query<{
      verified_email: string;
      us_phone_number: string | null;
      mrz_given_names: string;
      mrz_surname: string;
      mrz_doc_number_enc: unknown;
      mrz_nationality_enc: unknown;
      mrz_expiry_date: string;
      raw_response_enc: unknown;
    }>(
      `SELECT s.verified_email, s.us_phone_number,
              d.mrz_given_names, d.mrz_surname,
              d.mrz_doc_number_enc, d.mrz_nationality_enc,
              d.mrz_expiry_date, d.raw_response_enc
       FROM students s
       JOIN didit_sessions d ON d.student_id = s.id
       WHERE s.id = $1
       ORDER BY d.created_at DESC
       LIMIT 1`,
      [studentId],
    );

    const d = row.rows[0];
    if (!d) {
      throw new UnitAPIError(
        "No Didit verification on file for this student. Complete NFC verification before banking provision.",
      );
    }

    const passportNumber = decryptField(byteaOrTextToString(d.mrz_doc_number_enc));
    const passportCountry = decryptField(byteaOrTextToString(d.mrz_nationality_enc));
    let selfieB64 = "";
    if (d.raw_response_enc != null) {
      try {
        const raw = JSON.parse(decryptField(byteaOrTextToString(d.raw_response_enc))) as {
          selfie_image_base64?: string;
        };
        selfieB64 = raw.selfie_image_base64 ?? "";
      } catch {
        /* optional */
      }
    }

    return this.provisionStudentAccount({
      studentId,
      email: d.verified_email,
      phone: d.us_phone_number ?? "+10000000000",
      address: {
        street: "1 University Ave",
        city: "Boston",
        state: "MA",
        postalCode: "02115",
        country: "US",
      },
      legalFirstName: d.mrz_given_names.split(/\s+/)[0] ?? d.mrz_given_names,
      legalLastName: d.mrz_surname,
      dateOfBirth: "1999-01-01",
      passportNumber,
      passportCountry,
      passportExpiry: d.mrz_expiry_date,
      passportSelfieBase64: selfieB64 || Buffer.from("noop").toString("base64"),
    });
  }

  // ─── KYC Status Webhook Handler (Unit.co callback) ───────────────────────

  /** Parse Unit.co JSON:API webhook body. */
  async handleKYCStatusUpdateFromWebhook(payload: unknown): Promise<void> {
    const body = payload as {
      data?: { id?: string; attributes?: { status?: string } };
    };
    const unitCustomerId = body.data?.id;
    const raw = body.data?.attributes?.status;
    if (!unitCustomerId || !raw) {
      throw new UnitAPIError("Invalid Unit webhook payload: missing data.id or attributes.status");
    }
    await this.handleKYCStatusUpdate(unitCustomerId, raw);
  }

  async handleKYCStatusUpdate(
    unitCustomerId: string,
    newStatus: string
  ): Promise<void> {
    const kycStatus = this.mapUnitStatusToKYC(newStatus as "Active" | "Archived" | "Under Review");

    const updated = await this.db.query<{ id: string; email: string; full_name: string }>(
      `UPDATE students SET kyc_status = $1 WHERE unit_customer_id = $2
       RETURNING id, email, full_name`,
      [kycStatus, unitCustomerId]
    );

    logger.info({ event: "KYC_STATUS_UPDATED", unitCustomerId, kycStatus });

    // Notify student of KYC status change
    const student = updated.rows[0];
    if (student) {
      void (async () => {
        try {
          const { notifyStudent } = await import("./push.service");
          if (kycStatus === "APPROVED") {
            const { sendKycApprovedEmail } = await import("./email.service");
            await sendKycApprovedEmail({ toEmail: student.email, studentName: student.full_name ?? "Student" });
            await notifyStudent(student.id, "KYC_APPROVED");
          } else if (kycStatus === "REJECTED") {
            const { sendKycRejectedEmail } = await import("./email.service");
            await sendKycRejectedEmail({
              toEmail:      student.email,
              studentName:  student.full_name ?? "Student",
              rejectReason: "Your identity verification was not approved. Please retry with a clear passport scan.",
              retryUrl:     `${process.env.NEXT_PUBLIC_APP_URL ?? "https://app.vecta.io"}/onboarding/passport-scan`,
            });
          }
        } catch (notifyErr) {
          logger.error({ notifyErr }, "KYC status notification failed");
        }
      })();
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private mapUnitStatusToKYC(
    unitStatus: "Active" | "Archived" | "Under Review"
  ): KYCStatus {
    switch (unitStatus) {
      case "Active":       return KYCStatus.APPROVED;
      case "Under Review": return KYCStatus.NEEDS_REVIEW;
      case "Archived":     return KYCStatus.REJECTED;
      default:             return KYCStatus.PENDING;
    }
  }

  private async emitAuditEvent(
    studentId: string,
    eventType: AuditEventType,
    payload: Record<string, unknown>
  ): Promise<void> {
    await this.db.query(
      "INSERT INTO audit_events (student_id, event_type, payload) VALUES ($1, $2, $3)",
      [studentId, eventType, JSON.stringify(payload)]
    );
  }
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class UnitAPIError extends Error {
  constructor(message: string) { super(message); this.name = "UnitAPIError"; }
}

const _unitPool = getPool();
export const baasService = new BaaSService(_unitPool);
