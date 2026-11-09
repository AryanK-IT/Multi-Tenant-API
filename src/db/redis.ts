import Redis, { RedisOptions } from "ioredis";
import { env } from "../config/env";
import { logger } from "../common/logger";

let redisClient: Redis | null = null;

export function getRedisClient(customOptions?: RedisOptions): Redis {
  if (!redisClient) {
    redisClient = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      retryStrategy: () => null, // Do not endlessly reconnect when server is offline
      ...customOptions,
    });

    redisClient.on("error", (err) => {
      logger.error({ err: err.message }, "Redis client encountered error");
    });
  }

  return redisClient;
}

export function setRedisClient(client: Redis | null): void {
  redisClient = client;
}

export async function checkRedisHealth(): Promise<boolean> {
  try {
    const client = getRedisClient();
    if (client.status === "wait") {
      await client.connect();
    }
    const result = await client.ping();
    return result === "PONG";
  } catch {
    return false;
  }
}

export async function closeRedisConnection(): Promise<void> {
  if (redisClient) {
    try {
      await redisClient.quit();
    } catch {
      redisClient.disconnect();
    } finally {
      redisClient = null;
    }
  }
}
