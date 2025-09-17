import 'dotenv/config';
import { env } from './env.js';

export { env };

// 服务配置
export const service = {
  name: 'subscription-service',
  version: '1.0.0',
  nodeEnv: env.NODE_ENV,
  port: env.PORT,

  // 数据库连接池配置
  database: {
    url: env.DATABASE_URL,
    maxConnections: 20,
    connectionTimeoutMs: 5000,
  },

  // Redis配置
  redis: {
    url: env.REDIS_URL,
    password: env.REDIS_PASSWORD,
    maxRetries: 3,
    retryDelayOnFailover: 100,
  },

  // Stripe配置
  stripe: {
    secretKey: env.STRIPE_SECRET_KEY,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    publishableKey: env.STRIPE_PUBLISHABLE_KEY,
  },

  // 安全配置
  security: {
    internalApiKey: env.INTERNAL_API_KEY,
    corsOrigin: env.CORS_ORIGIN,
  },

  // 外部服务配置
  externalServices: {
    authService: env.AUTH_SERVICE_URL || 'http://localhost:8087',
  },

  // 业务配置
  business: {
    trialPeriodDays: env.TRIAL_PERIOD_DAYS,
    yearlyDiscount: env.YEARLY_DISCOUNT,
  },

  // 日志配置
  logging: {
    level: env.LOG_LEVEL,
    prettyPrint: env.NODE_ENV === 'development',
  },
};
