/**
 * services/identity-service/src/push.service.ts
 *
 * Push notification service using the Expo Push API.
 *
 * Notifications sent:
 *   TOKEN_USED       — "A landlord viewed your Vecta ID"
 *   KYC_APPROVED     — "Your identity is verified! Vecta ID is live."
 *   KYC_REJECTED     — "Identity verification needs attention"
 *   LOC_GENERATED    — "Your Letter of Credit is ready"
 *   FLIGHT_RECORDED  — "Rental income logged: $XX.XX" (LESSOR only)
 *   DSO_MEMO_READY   — "DSO compliance memo ready to share"
 *
 * Architecture:
 *   - Student registers Expo token on app launch → stored in student_push_tokens
 *   - Every notification type is fire-and-forget (never blocks the main flow)
 *   - Invalid tokens auto-deactivated (Expo returns DeviceNotRegistered)
 *   - Batch sends for bulk notifications (up to 100 per Expo API call)
 */

import { query } from '@vecta/database';
import { createLogger } from '@vecta/logger';

const logger = createLogger('push-service');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationCategory =
  | 'TOKEN_USED'
  | 'KYC_APPROVED'
  | 'KYC_REJECTED'
  | 'LOC_GENERATED'
  | 'FLIGHT_RECORDED'
  | 'DSO_MEMO_READY';

interface ExpoPushMessage {
  to:       string;   // ExponentPushToken[...]
  title:    string;
  body:     string;
  data?:    Record<string, unknown>;
  sound?:   'default' | null;
  badge?:   number;
  priority?: 'default' | 'normal' | 'high';
}

interface ExpoPushTicket {
  status:  'ok' | 'error';
  id?:     string;
  message?: string;
  details?: { error?: string };
}

// ---------------------------------------------------------------------------
// Notification copy per category
// ---------------------------------------------------------------------------

const NOTIFICATION_COPY: Record<NotificationCategory, (data?: Record<string, unknown>) => { title: string; body: string }> = {
  TOKEN_USED:     ()    => ({ title: '🔍 Landlord Viewed Your Profile', body: 'A landlord opened your Vecta ID verification link. Check your sharing links.' }),
  KYC_APPROVED:  ()    => ({ title: '✅ Identity Verified!', body: 'Your Vecta ID is live. Share it with landlords to prove your identity and financial standing.' }),
  KYC_REJECTED:  ()    => ({ title: '⚠️ Verification Needs Attention', body: 'Your identity verification needs to be retried. Tap to see instructions.' }),
  LOC_GENERATED: (d)   => ({ title: '📄 Letter of Credit Ready', body: `Your LoC for $${d?.monthlyRent ?? '—'}/mo is generated and ready to share.` }),
  FLIGHT_RECORDED:(d)  => ({ title: '💰 Rental Income Logged', body: `$${d?.incomeUsd ?? '—'} earned. Schedule E passive income — flight recorder updated.` }),
  DSO_MEMO_READY:()    => ({ title: '📋 DSO Memo Ready', body: 'Your F-1 compliance memo is ready to share with your Designated School Official.' }),
};

// ---------------------------------------------------------------------------
// Register / update push token
// ---------------------------------------------------------------------------

export async function registerPushToken(
  studentId: string,
  expoToken: string,
  deviceType: 'ios' | 'android',
): Promise<void> {
  if (!expoToken.startsWith('ExponentPushToken[')) {
    logger.warn({ studentId, expoToken: expoToken.slice(0, 20) }, 'Invalid Expo token format');
    return;
  }

  await query(
    `INSERT INTO student_push_tokens (student_id, expo_token, device_type)
     VALUES ($1, $2, $3)
     ON CONFLICT (expo_token) DO UPDATE
       SET student_id  = EXCLUDED.student_id,
           device_type = EXCLUDED.device_type,
           is_active   = TRUE,
           updated_at  = NOW()`,
    [studentId, expoToken, deviceType],
  );

  logger.info({ studentId, deviceType }, 'Push token registered');
}

// ---------------------------------------------------------------------------
// Send push notification to a student (by studentId)
// ---------------------------------------------------------------------------

export async function notifyStudent(
  studentId: string,
  category:  NotificationCategory,
  data?:     Record<string, unknown>,
): Promise<void> {
  // Fetch active push tokens for this student
  const result = await query<{ expo_token: string }>(
    `SELECT expo_token FROM student_push_tokens
     WHERE student_id = $1 AND is_active = TRUE`,
    [studentId],
  );

  if (result.rows.length === 0) {
    logger.debug({ studentId, category }, 'No push tokens for student — skipping');
    return;
  }

  const copy = NOTIFICATION_COPY[category](data);

  const messages: ExpoPushMessage[] = result.rows.map((row) => ({
    to:       row.expo_token,
    title:    copy.title,
    body:     copy.body,
    data:     { category, ...data },
    sound:    'default',
    priority: category === 'TOKEN_USED' ? 'high' : 'default',
  }));

  await sendBatch(messages, studentId);
}

// ---------------------------------------------------------------------------
// Send a batch of push messages (Expo limit: 100 per request)
// ---------------------------------------------------------------------------

async function sendBatch(
  messages:  ExpoPushMessage[],
  studentId: string,
): Promise<void> {
  // Chunk into groups of 100
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);

    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept:         'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chunk),
      });

      if (!res.ok) {
        logger.error({ status: res.status, studentId }, 'Expo push batch failed');
        return;
      }

      const { data: tickets } = await res.json() as { data: ExpoPushTicket[] };

      // Handle DeviceNotRegistered — deactivate the token
      for (let j = 0; j < tickets.length; j++) {
        const ticket = tickets[j];
        const msg    = chunk[j];

        if (!ticket || !msg) continue;

        if (
          ticket.status === 'error' &&
          ticket.details?.error === 'DeviceNotRegistered'
        ) {
          logger.info({ token: msg.to.slice(-8), studentId }, 'Deactivating unregistered push token');
          await query(
            `UPDATE student_push_tokens SET is_active = FALSE, updated_at = NOW()
             WHERE expo_token = $1`,
            [msg.to],
          );
        }
      }

      logger.info(
        { count: chunk.length, studentId, category: chunk[0]?.data?.category },
        'Push batch sent',
      );
    } catch (err) {
      logger.error({ err, studentId }, 'Push notification error');
    }
  }
}
