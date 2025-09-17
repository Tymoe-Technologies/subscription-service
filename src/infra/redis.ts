import Redis from 'ioredis';
import { service } from '../config/config.js';
import { logger } from '../utils/logger.js';

let redis: Redis | null = null;

export function createRedisClient(): Redis {
  if (redis) {
    return redis;
  }

  const redisOptions: Record<string, unknown> = {
    maxRetriesPerRequest: service.redis.maxRetries,
    lazyConnect: true,
    connectTimeout: 5000,
    commandTimeout: 5000,
  };

  if (service.redis.password) {
    redisOptions.password = service.redis.password;
  }

  redis = new Redis(service.redis.url, redisOptions);

  redis.on('connect', () => {
    logger.info('Redis connected');
  });

  redis.on('error', error => {
    logger.error('Redis connection error:', error);
  });

  redis.on('close', () => {
    logger.info('Redis connection closed');
  });

  return redis;
}

export function getRedisClient(): Redis | null {
  return redis;
}

export async function isRedisConnected(): Promise<boolean> {
  try {
    if (!redis) {
      return false;
    }
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}

// Redis缓存工具类
export class CacheService {
  private redis: Redis;

  constructor() {
    this.redis = createRedisClient();
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error('Redis get error:', error);
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds) {
        await this.redis.setex(key, ttlSeconds, serialized);
      } else {
        await this.redis.set(key, serialized);
      }
    } catch (error) {
      logger.error('Redis set error:', error);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      logger.error('Redis delete error:', error);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      logger.error('Redis exists error:', error);
      return false;
    }
  }

  // 分布式锁
  async acquireLock(lockKey: string, ttlSeconds: number = 30): Promise<boolean> {
    try {
      const result = await this.redis.set(lockKey, '1', 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch (error) {
      logger.error('Redis acquire lock error:', error);
      return false;
    }
  }

  async releaseLock(lockKey: string): Promise<void> {
    try {
      await this.redis.del(lockKey);
    } catch (error) {
      logger.error('Redis release lock error:', error);
    }
  }
}

export const cacheService = new CacheService();

// 优雅关闭Redis连接
export async function closeRedisConnection(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}
