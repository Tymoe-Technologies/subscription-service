import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';

// 简化的路由导入
import { organizationRoutes } from './routes/organization.controller';
import { subscriptionRoutes } from './routes/subscription.controller';
import { webhookRoutes } from './routes/webhook.controller';
import { adminRoutes } from './routes/admin.controller';
import { microserviceUsageRoutes } from './routes/microserviceUsage.controller';

export function createApp(): express.Application {
  const app = express();

  // CORS配置
  app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  }));

  // Webhook路由需要在JSON解析之前设置（raw body）
  app.use('/webhooks', express.raw({ type: 'application/json' }), webhookRoutes);

  // JSON解析中间件
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // 健康检查
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'subscription-service',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    });
  });

  // API路由 - 简化版本
  app.use('/organizations', organizationRoutes);
  app.use('/subscriptions', subscriptionRoutes);
  app.use('/usage', microserviceUsageRoutes);
  app.use('/admin', adminRoutes);

  // 全局错误处理
  app.use(errorHandler);

  return app;
}