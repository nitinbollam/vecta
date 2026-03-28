/**
 * Single shared Redis client for the API gateway (rate limits, magic-link throttles, etc.).
 * Avoids circular imports with server.ts bootstrap.
 */
import Redis from "ioredis";

let instance: Redis | null = null;

export function getRedisGateway(): Redis {
  if (!instance) {
    instance = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
  }
  return instance;
}
