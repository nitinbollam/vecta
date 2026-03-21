/**
 * services/identity-service/src/email.service.ts
 *
 * Transactional email via SendGrid (primary) with SES fallback.
 *
 * Templates:
 *   landlord-verify          — magic link for landlord email verification
 *   landlord-upgrade-trusted — background check completion notification
 *   student-token-used       — notify student when landlord opens their Vecta ID
 *   student-kyc-approved     — KYC approval confirmation
 *   student-kyc-rejected     — KYC rejection with retry instructions
 *   loc-generated            — Letter of Credit ready
 *   dso-memo-ready           — DSO compliance memo ready
 */

import { createLogger } from '@vecta/logger';

const logger = createLogger('email-service');

// ---------------------------------------------------------------------------
// Provider config
// ---------------------------------------------------------------------------

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY ?? '';
const FROM_EMAIL       = process.env.FROM_EMAIL ?? 'noreply@vecta.io';
const FROM_NAME        = 'Vecta';
const APP_URL          = process.env.NEXT_PUBLIC_APP_URL ?? 'https://verify.vecta.io';

// ---------------------------------------------------------------------------
// Base send function (SendGrid REST API)
// ---------------------------------------------------------------------------

interface SendGridPersonalization {
  to:                   Array<{ email: string; name?: string }>;
  dynamic_template_data: Record<string, string | number | boolean>;
}

interface SendGridPayload {
  from:             { email: string; name: string };
  personalizations: SendGridPersonalization[];
  template_id:      string;
}

async function sendViaProvider(payload: SendGridPayload): Promise<void> {
  if (!SENDGRID_API_KEY) {
    // Dev mode — log the email instead of sending
    logger.info({
      to:       payload.personalizations[0]?.to[0]?.email,
      template: payload.template_id,
      vars:     payload.personalizations[0]?.dynamic_template_data,
    }, 'DEV: email send skipped (no SENDGRID_API_KEY)');
    return;
  }

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    logger.error({ status: res.status, body }, 'SendGrid send failed');
    throw new Error(`Email send failed: ${res.status}`);
  }

  logger.info(
    { to: payload.personalizations[0]?.to[0]?.email, template: payload.template_id },
    'Email sent',
  );
}

// ---------------------------------------------------------------------------
// Template IDs (set in SendGrid Dynamic Templates dashboard)
// ---------------------------------------------------------------------------

const TEMPLATES = {
  landlordVerify:         process.env.SG_TEMPLATE_LANDLORD_VERIFY         ?? 'd-landlord-verify',
  landlordUpgradeTrusted: process.env.SG_TEMPLATE_LANDLORD_UPGRADE        ?? 'd-landlord-upgrade',
  studentTokenUsed:       process.env.SG_TEMPLATE_STUDENT_TOKEN_USED      ?? 'd-student-token-used',
  studentKycApproved:     process.env.SG_TEMPLATE_STUDENT_KYC_APPROVED    ?? 'd-student-kyc-approved',
  studentKycRejected:     process.env.SG_TEMPLATE_STUDENT_KYC_REJECTED    ?? 'd-student-kyc-rejected',
  locGenerated:           process.env.SG_TEMPLATE_LOC_GENERATED           ?? 'd-loc-generated',
  dsoMemoReady:           process.env.SG_TEMPLATE_DSO_MEMO                ?? 'd-dso-memo-ready',
} as const;

// ---------------------------------------------------------------------------
// Public send functions
// ---------------------------------------------------------------------------

/**
 * Landlord magic-link verification email.
 * Link is single-use and expires in 1 hour.
 */
export async function sendLandlordVerifyEmail(params: {
  toEmail:    string;
  toName?:    string;
  verifyUrl:  string;
}): Promise<void> {
  await sendViaProvider({
    from: { email: FROM_EMAIL, name: FROM_NAME },
    personalizations: [{
      to: [{ email: params.toEmail, ...(params.toName != null ? { name: params.toName } : {}) }],
      dynamic_template_data: {
        verify_url:    params.verifyUrl,
        expires_hours: 1,
        support_email: 'landlords@vecta.io',
        app_url:       APP_URL,
      },
    }],
    template_id: TEMPLATES.landlordVerify,
  });
}

/**
 * Notify landlord that their background check passed → TRUSTED tier.
 */
export async function sendLandlordUpgradeEmail(params: {
  toEmail:   string;
  toName?:   string;
}): Promise<void> {
  await sendViaProvider({
    from: { email: FROM_EMAIL, name: FROM_NAME },
    personalizations: [{
      to: [{ email: params.toEmail, ...(params.toName != null ? { name: params.toName } : {}) }],
      dynamic_template_data: {
        portal_url:    `${APP_URL}/verify`,
        support_email: 'landlords@vecta.io',
      },
    }],
    template_id: TEMPLATES.landlordUpgradeTrusted,
  });
}

/**
 * Notify student that a landlord opened their Vecta ID sharing link.
 * Provides a link to the token management screen to revoke if needed.
 */
export async function sendStudentTokenUsedEmail(params: {
  toEmail:     string;
  studentName: string;
  usedAt:      Date;
  tokensUrl:   string;   // deep link to profile/tokens screen
}): Promise<void> {
  await sendViaProvider({
    from: { email: FROM_EMAIL, name: FROM_NAME },
    personalizations: [{
      to: [{ email: params.toEmail, name: params.studentName }],
      dynamic_template_data: {
        student_name: params.studentName,
        used_at:      params.usedAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }),
        tokens_url:   params.tokensUrl,
        support_email: 'support@vecta.io',
      },
    }],
    template_id: TEMPLATES.studentTokenUsed,
  });
}

/**
 * Notify student that KYC is approved and their Vecta ID is live.
 */
export async function sendKycApprovedEmail(params: {
  toEmail:     string;
  studentName: string;
}): Promise<void> {
  await sendViaProvider({
    from: { email: FROM_EMAIL, name: FROM_NAME },
    personalizations: [{
      to: [{ email: params.toEmail, name: params.studentName }],
      dynamic_template_data: {
        student_name: params.studentName,
        app_url:      APP_URL,
        support_email: 'support@vecta.io',
      },
    }],
    template_id: TEMPLATES.studentKycApproved,
  });
}

/**
 * Notify student that KYC was rejected, with retry instructions.
 */
export async function sendKycRejectedEmail(params: {
  toEmail:      string;
  studentName:  string;
  rejectReason: string;
  retryUrl:     string;
}): Promise<void> {
  await sendViaProvider({
    from: { email: FROM_EMAIL, name: FROM_NAME },
    personalizations: [{
      to: [{ email: params.toEmail, name: params.studentName }],
      dynamic_template_data: {
        student_name:   params.studentName,
        reject_reason:  params.rejectReason,
        retry_url:      params.retryUrl,
        support_email:  'support@vecta.io',
      },
    }],
    template_id: TEMPLATES.studentKycRejected,
  });
}

/**
 * Notify student their Letter of Credit is ready for sharing.
 */
export async function sendLocReadyEmail(params: {
  toEmail:     string;
  studentName: string;
  locId:       string;
  expiresAt:   Date;
}): Promise<void> {
  await sendViaProvider({
    from: { email: FROM_EMAIL, name: FROM_NAME },
    personalizations: [{
      to: [{ email: params.toEmail, name: params.studentName }],
      dynamic_template_data: {
        student_name: params.studentName,
        loc_url:      `${APP_URL}/housing/loc/${params.locId}`,
        expires_date: params.expiresAt.toLocaleDateString('en-US', { dateStyle: 'medium' }),
        support_email: 'support@vecta.io',
      },
    }],
    template_id: TEMPLATES.locGenerated,
  });
}
