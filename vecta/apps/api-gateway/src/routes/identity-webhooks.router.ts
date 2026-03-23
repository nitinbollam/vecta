/**
 * Public provider webhooks (HMAC). Mounted at /webhooks — must run BEFORE JWT middleware.
 */
import { Router, Request, Response } from "express";
import { identityService } from "../../../../services/identity-service/src/didit.service";
import { baasService } from "../../../../services/identity-service/src/unit.service";
import { createLogger } from "@vecta/logger";
import { hmacVerify } from "@vecta/crypto";

const logger = createLogger("identity-webhooks");
const router = Router();

router.post("/didit", async (req: Request, res: Response) => {
  const signature = req.headers["x-didit-signature"] as string;

  if (!signature) {
    res.status(400).json({ error: "MISSING_SIGNATURE" });
    return;
  }

  const rawBody = JSON.stringify(req.body);
  const secret = process.env.DIDIT_WEBHOOK_SECRET ?? "";

  if (!hmacVerify(rawBody, signature, secret)) {
    logger.warn({ signature }, "Didit webhook HMAC verification failed");
    res.status(401).json({ error: "INVALID_SIGNATURE" });
    return;
  }

  try {
    await identityService.processVerificationResult(
      String(req.body?.sessionId ?? ""),
      rawBody,
      signature,
    );
    res.status(200).json({ received: true });
  } catch (err) {
    logger.error({ err }, "Didit webhook processing failed");
    res.status(500).json({ error: "WEBHOOK_PROCESSING_FAILED" });
  }
});

router.post("/unit", async (req: Request, res: Response) => {
  const signature = req.headers["x-unit-signature"] as string;

  if (!signature) {
    res.status(400).json({ error: "MISSING_SIGNATURE" });
    return;
  }

  const rawBody = JSON.stringify(req.body);
  const secret = process.env.UNIT_WEBHOOK_SECRET ?? "";

  if (!hmacVerify(rawBody, signature, secret)) {
    logger.warn({}, "Unit webhook HMAC verification failed");
    res.status(401).json({ error: "INVALID_SIGNATURE" });
    return;
  }

  try {
    await baasService.handleKYCStatusUpdateFromWebhook(req.body);
    res.status(200).json({ received: true });
  } catch (err) {
    logger.error({ err }, "Unit webhook processing failed");
    res.status(500).json({ error: "WEBHOOK_PROCESSING_FAILED" });
  }
});

export { router as identityWebhooksRouter };
