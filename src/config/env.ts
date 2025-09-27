import { z } from 'zod';

const envSchema = z.object({
  // 基础配置
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(8088),

  // 数据库配置
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Redis配置
  REDIS_URL: z.string().default('redis://localhost:6379/1'),
  REDIS_PASSWORD: z.string().optional(),

  // Stripe配置
  STRIPE_SECRET_KEY: z.string().min(1, 'STRIPE_SECRET_KEY is required'),
  STRIPE_WEBHOOK_SECRET: z.string().min(1, 'STRIPE_WEBHOOK_SECRET is required'),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),

  // 内部API认证
  INTERNAL_API_KEY: z.string().min(1, 'INTERNAL_API_KEY is required'),


  // 日志配置
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),

  // CORS配置
  CORS_ORIGIN: z.string().default('*'),

  // 试用期配置（天数）
  TRIAL_PERIOD_DAYS: z.coerce.number().default(30),

  // 年度折扣（百分比）
  YEARLY_DISCOUNT: z.coerce.number().default(20),

  // 外部服务配置
  AUTH_SERVICE_URL: z.string().default('http://localhost:8087'),
});

function validateEnv() {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.errors.map(err => `${err.path.join('.')}: ${err.message}`);
      throw new Error(`环境变量验证失败:\n${missingVars.join('\n')}`);
    }
    throw error;
  }
}

export const env = validateEnv();

export type Environment = z.infer<typeof envSchema>;
