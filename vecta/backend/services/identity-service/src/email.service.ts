/**
 * services/identity-service/src/email.service.ts
 *
 * Transactional email via SendGrid dynamic templates (env template IDs) with HTML fallbacks.
 */

import { createLogger } from '@vecta/logger';

const logger = createLogger('email-service');

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY ?? '';

function getFrom(): { email: string; name: string } {
  return {
    email: process.env.SENDGRID_FROM_EMAIL || process.env.FROM_EMAIL || 'noreply@vecta.io',
    name: process.env.SENDGRID_FROM_NAME || 'Vecta',
  };
}

interface TemplatePayload {
  from: { email: string; name: string };
  personalizations: Array<{
    to: Array<{ email: string; name?: string }>;
    dynamic_template_data: Record<string, string | number | boolean>;
  }>;
  template_id: string;
}

interface HtmlPayload {
  from: { email: string; name: string };
  personalizations: Array<{ to: Array<{ email: string; name?: string }> }>;
  subject: string;
  content: Array<{ type: string; value: string }>;
}

async function postSendGrid(body: unknown): Promise<void> {
  if (!SENDGRID_API_KEY) {
    logger.info({ body }, 'DEV: email send skipped (no SENDGRID_API_KEY)');
    return;
  }

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    logger.error({ status: res.status, text }, 'SendGrid send failed');
    throw new Error(`Email send failed: ${res.status}`);
  }
}

async function sendTemplateOrHtml(opts: {
  to: { email: string; name?: string };
  templateId?: string;
  dynamicTemplateData?: Record<string, string | number | boolean>;
  subject: string;
  html: string;
}): Promise<void> {
  const from = getFrom();
  if (opts.templateId) {
    const payload: TemplatePayload = {
      from,
      personalizations: [
        {
          to: [{ email: opts.to.email, ...(opts.to.name != null ? { name: opts.to.name } : {}) }],
          dynamic_template_data: opts.dynamicTemplateData ?? {},
        },
      ],
      template_id: opts.templateId,
    };
    await postSendGrid(payload);
    logger.info({ to: opts.to.email, template: opts.templateId }, 'Email sent (template)');
    return;
  }

  const htmlPayload: HtmlPayload = {
    from,
    personalizations: [{ to: [{ email: opts.to.email, ...(opts.to.name != null ? { name: opts.to.name } : {}) }] }],
    subject: opts.subject,
    content: [{ type: 'text/html', value: opts.html }],
  };
  await postSendGrid(htmlPayload);
  logger.info({ to: opts.to.email }, 'Email sent (html fallback)');
}

// ---------------------------------------------------------------------------
// Public send functions
// ---------------------------------------------------------------------------

export async function sendStudentMagicLinkEmail(params: {
  toEmail: string;
  magicLinkUrl: string;
  studentName?: string;
}): Promise<void> {
  const name = params.studentName?.trim() || 'there';
  const tid = process.env.SENDGRID_MAGIC_LINK_TEMPLATE_ID;
  const html = `<h2>Sign in to Vecta</h2><p>Click to sign in: <a href="${params.magicLinkUrl}">${params.magicLinkUrl}</a></p><p>Expires in 15 minutes.</p>`;
  await sendTemplateOrHtml({
    to: { email: params.toEmail },
    templateId: tid,
    dynamicTemplateData: { magic_link: params.magicLinkUrl, name, app_name: 'Vecta' },
    subject: 'Sign in to Vecta',
    html,
  });
}

export async function sendLandlordVerifyEmail(params: {
  toEmail: string;
  toName?: string;
  verifyUrl: string;
}): Promise<void> {
  const name = params.toName?.trim() || 'there';
  const tid = process.env.SENDGRID_LANDLORD_MAGIC_LINK_TEMPLATE_ID;
  const html = `<h2>Verify your email</h2><p>Click to verify: <a href="${params.verifyUrl}">${params.verifyUrl}</a></p>`;
  await sendTemplateOrHtml({
    to: { email: params.toEmail, ...(params.toName != null ? { name: params.toName } : {}) },
    templateId: tid,
    dynamicTemplateData: { magic_link: params.verifyUrl, name },
    subject: 'Verify your Vecta landlord account',
    html,
  });
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://verify.vecta.io';

export async function sendLandlordUpgradeEmail(params: {
  toEmail: string;
  toName?: string;
}): Promise<void> {
  const tid =
    process.env.SG_TEMPLATE_LANDLORD_UPGRADE ??
    process.env.SENDGRID_LANDLORD_UPGRADE_TEMPLATE_ID;
  const html = `<p>Your background check passed. Open <a href="${APP_URL}/verify">Vecta</a> to continue.</p>`;
  await sendTemplateOrHtml({
    to: { email: params.toEmail, ...(params.toName != null ? { name: params.toName } : {}) },
    templateId: tid,
    dynamicTemplateData: {
      portal_url: `${APP_URL}/verify`,
      support_email: 'landlords@vecta.io',
    },
    subject: 'Vecta — account upgraded',
    html,
  });
}

export async function sendStudentTokenUsedEmail(params: {
  toEmail: string;
  studentName: string;
  usedAt: Date;
  tokensUrl: string;
}): Promise<void> {
  const tid = process.env.SG_TEMPLATE_STUDENT_TOKEN_USED;
  const html = `<p>Hi ${params.studentName}, a landlord opened your Vecta ID link at ${params.usedAt.toISOString()}.</p><p><a href="${params.tokensUrl}">Manage sharing</a></p>`;
  await sendTemplateOrHtml({
    to: { email: params.toEmail, name: params.studentName },
    templateId: tid,
    dynamicTemplateData: {
      student_name: params.studentName,
      used_at: params.usedAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }),
      tokens_url: params.tokensUrl,
      support_email: 'support@vecta.io',
    },
    subject: 'Your Vecta ID link was used',
    html,
  });
}

export async function sendKycApprovedEmail(params: {
  toEmail: string;
  studentName: string;
}): Promise<void> {
  const tid = process.env.SENDGRID_KYC_APPROVED_TEMPLATE_ID;
  const html =
    '<p>Your identity has been verified. Open Vecta to continue.</p>';
  await sendTemplateOrHtml({
    to: { email: params.toEmail, name: params.studentName },
    templateId: tid,
    dynamicTemplateData: { name: params.studentName, app_name: 'Vecta' },
    subject: 'Vecta — identity verified',
    html,
  });
}

export async function sendKycRejectedEmail(params: {
  toEmail: string;
  studentName: string;
  rejectReason: string;
  retryUrl: string;
}): Promise<void> {
  const tid = process.env.SG_TEMPLATE_STUDENT_KYC_REJECTED;
  const html = `<p>Hi ${params.studentName}, we could not verify your identity: ${params.rejectReason}</p><p><a href="${params.retryUrl}">Try again</a></p>`;
  await sendTemplateOrHtml({
    to: { email: params.toEmail, name: params.studentName },
    templateId: tid,
    dynamicTemplateData: {
      student_name: params.studentName,
      reject_reason: params.rejectReason,
      retry_url: params.retryUrl,
      support_email: 'support@vecta.io',
    },
    subject: 'Vecta — identity verification update',
    html,
  });
}

export async function sendLocReadyEmail(params: {
  toEmail: string;
  studentName: string;
  locId: string;
  expiresAt: Date;
  pdfUrl?: string;
}): Promise<void> {
  const tid = process.env.SENDGRID_LOC_READY_TEMPLATE_ID;
  const locUrl =
    params.pdfUrl ?? `${APP_URL}/housing/loc/${params.locId}`;
  const html = `<p>Hi ${params.studentName}, your Letter of Credit is ready.</p><p><a href="${locUrl}">Open PDF</a></p>`;
  await sendTemplateOrHtml({
    to: { email: params.toEmail, name: params.studentName },
    templateId: tid,
    dynamicTemplateData: {
      name: params.studentName,
      loc_url: locUrl,
      expires_date: params.expiresAt.toLocaleDateString('en-US', { dateStyle: 'medium' }),
      support_email: 'support@vecta.io',
    },
    subject: 'Vecta — Letter of Credit ready',
    html,
  });
}
