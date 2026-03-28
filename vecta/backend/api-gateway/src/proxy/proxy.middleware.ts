import { Request, Response, NextFunction } from 'express';
import { SERVICE_REGISTRY } from './service-registry';
import { signInternalRequest } from '@vecta/auth';
import { createLogger } from '@vecta/logger';

const logger = createLogger('proxy');

export function createServiceProxy(serviceName: keyof typeof SERVICE_REGISTRY) {
  return async (req: Request, res: Response, _next: NextFunction) => {
    const service = SERVICE_REGISTRY[serviceName];
    const qs = req.url.includes('?') ? '?' + req.url.split('?')[1] : '';
    const targetUrl = `${service.url}${req.path}${qs}`;

    try {
      const bodyJson = req.body ? JSON.stringify(req.body) : '';
      const internalHeaders = signInternalRequest(req.method, req.path, bodyJson);

      const response = await fetch(targetUrl, {
        method:  req.method,
        headers: {
          'Content-Type':    'application/json',
          'Authorization':   req.headers.authorization ?? '',
          'X-Request-ID':    (req.headers['x-request-id'] as string) ?? '',
          'X-Forwarded-For': req.ip ?? '',
          ...internalHeaders,
        },
        body: ['GET', 'HEAD', 'DELETE'].includes(req.method)
          ? undefined
          : bodyJson || undefined,
        signal: AbortSignal.timeout(service.timeout),
      });

      const data = await response.json();
      res.status(response.status).json(data);
    } catch (err) {
      logger.error({ err, service: serviceName, path: req.path }, 'Proxy error');
      if ((err as Error).name === 'TimeoutError') {
        res.status(504).json({ error: 'SERVICE_TIMEOUT', service: serviceName });
        return;
      }
      res.status(502).json({ error: 'SERVICE_UNAVAILABLE', service: serviceName });
    }
  };
}
