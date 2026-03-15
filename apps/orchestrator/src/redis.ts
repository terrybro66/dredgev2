import Redis from "ioredis";

let client: Redis | null = null;

export function getRedisClient(): Redis {
  if (!client) {
    client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
    });
  }
  return client;
}

export async function checkRedisHealth(c?: Redis): Promise<boolean> {
  const target = c ?? getRedisClient();
  try {
    await target.ping();
    return true;
  } catch {
    return false;
  }
}
