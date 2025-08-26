// src/config/config.ts
import 'dotenv/config';

export const config = {
    env: process.env.NODE_ENV || 'development',
    port: Number(process.env.PORT || 8088),

    databaseUrl: process.env.DATABASE_URL!,
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379/1',

    stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',

    internalApiKey: process.env.INTERNAL_API_KEY || '',
    logLevel: process.env.LOG_LEVEL || 'info',
};