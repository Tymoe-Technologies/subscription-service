import Redis from 'ioredis';
import { service } from '../config/config.js';

let redis: Redis | null = null;

export function createRedisClient(): Redis {
  if (redis) {
    return redis;
  }

  const redisOptions: any = {
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
    console.log('Redis connected');
  });

  redis.on('error', (error) => {
    console.error('Redis connection error:', error);
  });

  redis.on('close', () => {
    console.log('Redis connection closed');
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
  } catch (error) {
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
      console.error('Redis get error:', error);
      return null;
    }
  }

  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds) {
        await this.redis.setex(key, ttlSeconds, serialized);
      } else {
        await this.redis.set(key, serialized);
      }
    } catch (error) {
      console.error('Redis set error:', error);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      console.error('Redis delete error:', error);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      console.error('Redis exists error:', error);
      return false;
    }
  }

  // 分布式锁
  async acquireLock(lockKey: string, ttlSeconds: number = 30): Promise<boolean> {
    try {
      const result = await this.redis.set(lockKey, '1', 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch (error) {
      console.error('Redis acquire lock error:', error);
      return false;
    }
  }

  async releaseLock(lockKey: string): Promise<void> {
    try {
      await this.redis.del(lockKey);
    } catch (error) {
      console.error('Redis release lock error:', error);
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