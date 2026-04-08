import Redis from 'ioredis';
import { env } from './env';

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  retryStrategy: (times) => {
    if (times > 5) {
      console.error('❌ Redis connection failed after 5 retries');
      return null;
    }
    return Math.min(times * 200, 2000);
  },
  maxRetriesPerRequest: 3,
});

redis.on('error', (err) => {
  console.error('Redis error:', err.message);
});

redis.on('connect', () => {
  console.log('✅ Redis connected');
});

redis.on('reconnecting', () => {
  console.warn('⚠️  Redis reconnecting...');
});

export async function connectRedis(): Promise<void> {
  await redis.connect();
}
