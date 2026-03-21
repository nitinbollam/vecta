// packages/auth/src/rbac.ts
// ─── Vecta Role-Based Access Control ─────────────────────────────────────────
// CRITICAL COMPLIANCE: An F-1 student registered as LESSOR must be
// mathematically incapable of accepting a ride request. This is not a
// UI-level guard — it is enforced at the API layer and database constraint.

import { StudentRole } from "@vecta/types";
import type { Request, Response, NextFunction } from "express";
import { createClient } from "redis";
import { createLogger } from "@vecta/logger";
import type { RBACDecision } from "./rbac-audit";

const logger = createLogger("rbac");

export interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    roles: StudentRole[];
    sessionId: string;
    iat: number;
    exp: number;
  };
  correlationId?: string;
}

// ─── Permission Matrix ────────────────────────────────────────────────────────
// Maps resource:action -> allowed roles. Omission = deny.

export const PERMISSION_MAP: Record<string, StudentRole[]> = {
  // Identity
  "identity:read_own": [StudentRole.STUDENT, StudentRole.LESSOR],
  "identity:verify": [StudentRole.STUDENT, StudentRole.LESSOR],

  // Banking
  "banking:view_balance": [StudentRole.STUDENT, StudentRole.LESSOR],
  "banking:transfer": [StudentRole.STUDENT, StudentRole.LESSOR],

  // Housing
  "housing:apply": [StudentRole.STUDENT, StudentRole.LESSOR],
  "housing:view_roommates": [StudentRole.STUDENT, StudentRole.LESSOR],

  // Mobility — LESSOR actions (passive only)
  "mobility:enroll_vehicle": [StudentRole.STUDENT],  // Can enroll (becomes LESSOR)
  "mobility:view_lease_earnings": [StudentRole.LESSOR],
  "mobility:view_flight_recorder": [StudentRole.LESSOR],

  // ─── CRITICAL F-1 COMPLIANCE ──────────────────────────────────────────────
  // LESSOR is excluded here — only STUDENT may accept rides / go online as driver.
  "mobility:accept_ride": [StudentRole.STUDENT],
  "mobility:go_online_as_driver": [StudentRole.STUDENT],

  // Insurance
  "insurance:get_quotes": [StudentRole.STUDENT, StudentRole.LESSOR],

  // eSIM
  "esim:activate": [StudentRole.STUDENT, StudentRole.LESSOR],

  // DSO Memo
  "compliance:generate_dso_memo": [StudentRole.LESSOR],
};

// ─── Role Conflicts (cannot hold simultaneously) ──────────────────────────────
// A user CANNOT be both LESSOR and any driving role. If they attempt to
// accept a ride, they get a 403 with a compliance-specific error body.

const CONFLICTING_ROLES: Array<[StudentRole, StudentRole]> = [
  // If we ever add a non-F1 DRIVER role, it must conflict with LESSOR
];

/** JWT / middleware role string (subset maps to {@link StudentRole}). */
export type UserRole = string;

export interface RBACResult {
  allowed: boolean;
  reason?: string;
}

function parseStudentRole(role: string): StudentRole | null {
  if (role === StudentRole.STUDENT || role === StudentRole.LESSOR) return role;
  return null;
}

/**
 * Check a single JWT role string against the permission matrix (API gateway).
 */
export function checkPermission(role: UserRole, permission: string): RBACResult {
  const sr = parseStudentRole(role);
  const allowedRoles = PERMISSION_MAP[permission] ?? [];

  if (allowedRoles.length === 0) {
    return { allowed: false, reason: "INSUFFICIENT_ROLE" };
  }

  if (!sr || !allowedRoles.includes(sr)) {
    const isF1Block =
      sr === StudentRole.LESSOR &&
      (permission === "mobility:accept_ride" || permission === "mobility:go_online_as_driver");
    return {
      allowed: false,
      reason: isF1Block ? "F1_VISA_COMPLIANCE_VIOLATION" : "INSUFFICIENT_ROLE",
    };
  }

  return { allowed: true };
}

export function assertRoleConflictFree(roles: StudentRole[]): void {
  for (const [r1, r2] of CONFLICTING_ROLES) {
    if (roles.includes(r1) && roles.includes(r2)) {
      throw new RoleConflictError(
        `Role conflict: a user cannot simultaneously hold [${r1}] and [${r2}]. ` +
        `F-1 compliance violation prevented.`
      );
    }
  }
}

// ─── Authorization Middleware Factory ────────────────────────────────────────

/** Session-cookie auth (multi-role). Prefer {@link authMiddleware} + middleware `requirePermission` for JWT. */
export function requireSessionPermission(permission: string) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { user } = req;

      if (!user) {
        res.status(401).json({ error: "UNAUTHENTICATED", message: "No valid session." });
        return;
      }

      // Check role conflicts on every request (belt-and-suspenders)
      assertRoleConflictFree(user.roles);

      const allowedRoles = PERMISSION_MAP[permission] ?? [];

      const hasPermission = user.roles.some((role) => allowedRoles.includes(role));
      const isF1Block =
        (permission === "mobility:accept_ride" || permission === "mobility:go_online_as_driver") &&
        user.roles.includes(StudentRole.LESSOR);

      void import('./rbac-audit').then(({ auditRBACDecision }) => {
        const decision: RBACDecision = {
          actorId:         user.id,
          actorRole:       user.roles.join(','),
          attemptedAction: permission,
          result:          hasPermission ? 'ALLOWED' : 'BLOCKED',
        };
        if (!hasPermission) {
          decision.blockReason = isF1Block
            ? 'F1_VISA_COMPLIANCE_VIOLATION'
            : 'INSUFFICIENT_ROLE';
        }
        if (req.ip !== undefined) decision.ipAddress = req.ip;
        const ua = req.headers['user-agent'];
        if (typeof ua === 'string') decision.userAgent = ua;
        if (req.correlationId !== undefined) decision.correlationId = req.correlationId;
        auditRBACDecision(decision);
      });

      if (!hasPermission) {
        // Special handling for ride acceptance by LESSOR — log compliance event
        if (
          (permission === "mobility:accept_ride" || permission === "mobility:go_online_as_driver") &&
          user.roles.includes(StudentRole.LESSOR)
        ) {
          logger.warn({
            event: "F1_COMPLIANCE_BLOCK",
            studentId: user.id,
            permission,
            roles: user.roles,
            message: "LESSOR attempted to accept a ride — blocked by RBAC",
            sessionId: user.sessionId,
          });

          res.status(403).json({
            error: "F1_VISA_COMPLIANCE_VIOLATION",
            message:
              "Your account is registered as a Passive Vehicle Lessor. " +
              "Accepting ride requests constitutes active employment and is prohibited under F-1 visa regulations. " +
              "Your vehicle is generating passive rental income while you maintain visa compliance.",
            code: "LESSOR_CANNOT_DRIVE",
            learnMoreUrl: "https://vecta.app/compliance/f1-passive-income",
          });
          return;
        }

        res.status(403).json({
          error: "FORBIDDEN",
          message: `You do not have the required permission: ${permission}`,
          yourRoles: user.roles,
        });
        return;
      }

      next();
    } catch (err) {
      if (err instanceof RoleConflictError) {
        res.status(403).json({ error: "ROLE_CONFLICT", message: err.message });
        return;
      }
      next(err);
    }
  };
}

// ─── Session Validation ───────────────────────────────────────────────────────

export async function validateSession(
  sessionId: string,
  redis: ReturnType<typeof createClient>
): Promise<{ valid: boolean; revoked: boolean }> {
  const revoked = await redis.sIsMember("vecta:revoked_sessions", sessionId);
  if (revoked) {
    return { valid: false, revoked: true };
  }
  const exists = await redis.exists(`vecta:session:${sessionId}`);
  return { valid: exists === 1, revoked: false };
}

// ─── Custom Errors ────────────────────────────────────────────────────────────

export class RoleConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoleConflictError";
  }
}

export class F1ComplianceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "F1ComplianceError";
  }
}
