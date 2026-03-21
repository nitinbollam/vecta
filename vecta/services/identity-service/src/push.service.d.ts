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
export type NotificationCategory = 'TOKEN_USED' | 'KYC_APPROVED' | 'KYC_REJECTED' | 'LOC_GENERATED' | 'FLIGHT_RECORDED' | 'DSO_MEMO_READY';
export declare function registerPushToken(studentId: string, expoToken: string, deviceType: 'ios' | 'android'): Promise<void>;
export declare function notifyStudent(studentId: string, category: NotificationCategory, data?: Record<string, unknown>): Promise<void>;
//# sourceMappingURL=push.service.d.ts.map