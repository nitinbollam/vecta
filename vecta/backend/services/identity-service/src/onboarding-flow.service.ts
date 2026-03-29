/**
 * Onboarding state machine with compensating rollback helpers.
 */

import { query, queryOne } from "@vecta/database";
import { createLogger } from "@vecta/logger";

const logger = createLogger("onboarding-flow");

export type OnboardingStep =
  | "EMAIL_VERIFIED"
  | "KYC_INITIATED"
  | "KYC_VERIFIED"
  | "BANK_ACCOUNT_CREATED"
  | "ESIM_PROVISIONED"
  | "ONBOARDING_COMPLETE";

export type OnboardingStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETE" | "FAILED";

export class OnboardingFlowService {
  async advanceStep(studentId: string, step: OnboardingStep): Promise<void> {
    await query(
      `UPDATE students
       SET onboarding_step=$1, onboarding_status='IN_PROGRESS',
           onboarding_error=NULL, onboarding_updated_at=NOW()
       WHERE id=$2`,
      [step, studentId],
    );
    logger.info({ studentId, step }, "Onboarding step advanced");
  }

  async failStep(studentId: string, step: OnboardingStep, reason: string): Promise<void> {
    await query(
      `UPDATE students
       SET onboarding_step=$1, onboarding_status='FAILED',
           onboarding_error=$2, onboarding_updated_at=NOW()
       WHERE id=$3`,
      [step, reason, studentId],
    );
    logger.error({ studentId, step, reason }, "Onboarding step failed");
  }

  async complete(studentId: string): Promise<void> {
    await query(
      `UPDATE students
       SET onboarding_step='ONBOARDING_COMPLETE', onboarding_status='COMPLETE',
           onboarding_error=NULL, onboarding_updated_at=NOW()
       WHERE id=$1`,
      [studentId],
    );
    logger.info({ studentId }, "Onboarding complete");
  }

  async getState(studentId: string): Promise<{
    step: OnboardingStep;
    status: OnboardingStatus;
    error: string | null;
  }> {
    const row = await queryOne<{
      onboarding_step: string | null;
      onboarding_status: string | null;
      onboarding_error: string | null;
    }>(
      `SELECT onboarding_step, onboarding_status, onboarding_error FROM students WHERE id=$1`,
      [studentId],
    );
    return {
      step: (row?.onboarding_step ?? "EMAIL_VERIFIED") as OnboardingStep,
      status: (row?.onboarding_status ?? "IN_PROGRESS") as OnboardingStatus,
      error: row?.onboarding_error ?? null,
    };
  }

  async rollback(studentId: string, failedStep: OnboardingStep): Promise<void> {
    logger.warn({ studentId, failedStep }, "Rolling back onboarding step");

    switch (failedStep) {
      case "KYC_INITIATED":
        await query(
          `DELETE FROM didit_sessions ds
           USING students s
           WHERE ds.student_id = s.id
             AND ds.student_id = $1
             AND s.kyc_status IN ('PENDING','IN_PROGRESS','NEEDS_REVIEW')
             AND s.didit_verified_at IS NULL`,
          [studentId],
        );
        break;

      case "KYC_VERIFIED":
        await query(`UPDATE students SET kyc_status='PENDING' WHERE id=$1`, [studentId]);
        break;

      case "BANK_ACCOUNT_CREATED":
        await query(
          `UPDATE ledger_accounts
           SET status='CLOSED', closed_at=NOW()
           WHERE student_id=$1 AND status='ACTIVE'`,
          [studentId],
        );
        break;

      case "ESIM_PROVISIONED":
        logger.info({ studentId }, "eSIM provisioning failed — no rollback needed");
        break;

      default:
        break;
    }

    await this.failStep(studentId, failedStep, `Rolled back at ${failedStep}`);
  }
}

export const onboardingFlowService = new OnboardingFlowService();
