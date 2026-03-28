import express from 'express';
import { createLogger } from '@vecta/logger';

const app = express();
const logger = createLogger('compliance-service');
const PORT = parseInt(process.env.PORT ?? '3005', 10);

app.use(express.json({ limit: '100kb' }));

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'compliance-service',
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, '0.0.0.0', () => {
  logger.info({ port: PORT }, 'Compliance service started');
});
