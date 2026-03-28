/**
 * Public provider webhooks (HMAC over raw JSON body). Mounted at /webhooks — before JWT middleware.
 * Body must be parsed with express.raw({ type: 'application/json' }) so signatures match the provider.
 */
import { Router, Request, Response, NextFunction } from "express";
import { identityService } from "../../../../services/identity-service/src/didit.service";
import { baasService } from "../../../../services/identity-service/src/unit.service";
import { createLogger } from "@vecta/logger";
import { hmacVerify } from "@vecta/crypto";

const logger = createLogger("identity-webhooks");
const router = Router();

function rawPayload(req: Request): string {
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  if (typeof req.body === "string") return req.body;
  return JSON.stringify(req.body ?? {});
}

function safeHmacVerify(payload: string, signature: string, secret: string): boolean {
  try {
    return hmacVerify(payload, signature, secret);
  } catch {
    return false;
  }
}

function verifyDiditWebhook(req: Request, res: Response, next: NextFunction): void {
  const signature = req.headers["x-didit-signature"] as string | undefined;
  const webhookSecret = process.env.DIDIT_WEBHOOK_SECRET ?? "";

  if (!webhookSecret) {
    logger.error("DIDIT_WEBHOOK_SECRET not set — rejecting webhook");
    res.status(500).json({ error: "Webhook not configured" });
    return;
  }

  if (!signature) {
    logger.warn("Didit webhook received without signature");
    res.status(401).json({ error: "Missing signature" });
    return;
  }

  const rawBody = rawPayload(req);
  if (!safeHmacVerify(rawBody, signature, webhookSecret)) {
    logger.warn({ ip: req.ip }, "Didit webhook signature mismatch — possible forgery");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  try {
    (req as Request & { parsedWebhookJson?: unknown }).parsedWebhookJson = JSON.parse(rawBody || "{}");
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }
  next();
}

function verifyUnitWebhook(req: Request, res: Response, next: NextFunction): void {
  const signature = req.headers["x-unit-signature"] as string | undefined;
  const webhookSecret = process.env.UNIT_WEBHOOK_SECRET ?? "";

  if (!webhookSecret) {
    logger.error("UNIT_WEBHOOK_SECRET not set — rejecting webhook");
    res.status(500).json({ error: "Webhook not configured" });
    return;
  }

  if (!signature) {
    logger.warn("Unit webhook received without signature");
    res.status(401).json({ error: "Missing signature" });
    return;
  }

  const rawBody = rawPayload(req);
  if (!safeHmacVerify(rawBody, signature, webhookSecret)) {
    logger.warn({ ip: req.ip }, "Unit webhook signature mismatch — possible forgery");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  try {
    (req as Request & { parsedWebhookJson?: unknown }).parsedWebhookJson = JSON.parse(rawBody || "{}");
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }
  next();
}

router.post("/didit", verifyDiditWebhook, async (req: Request, res: Response) => {
  const body = (req as Request & { parsedWebhookJson?: Record<string, unknown> }).parsedWebhookJson ?? {};

  try {
    await identityService.processVerificationResult(
      String(body?.sessionId ?? ""),
      JSON.stringify(body),
      String(req.headers["x-didit-signature"] ?? ""),
    );
    res.status(200).json({ received: true });
  } catch (err) {
    logger.error({ err }, "Didit webhook processing failed");
    res.status(500).json({ error: "WEBHOOK_PROCESSING_FAILED" });
  }
});

router.post("/unit", verifyUnitWebhook, async (req: Request, res: Response) => {
  const body = (req as Request & { parsedWebhookJson?: Record<string, unknown> }).parsedWebhookJson ?? {};

  try {
    await baasService.handleKYCStatusUpdateFromWebhook(body);
    res.status(200).json({ received: true });
  } catch (err) {
    logger.error({ err }, "Unit webhook processing failed");
    res.status(500).json({ error: "WEBHOOK_PROCESSING_FAILED" });
  }
});

export { router as identityWebhooksRouter };
