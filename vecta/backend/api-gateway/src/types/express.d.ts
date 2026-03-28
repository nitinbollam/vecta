import type { VectaIDTokenPayload } from '@vecta/types';

declare global {
  namespace Express {
    interface Request {
      vectaUser?: VectaIDTokenPayload;
      correlationId?: string;
    }
  }
}

export {};
