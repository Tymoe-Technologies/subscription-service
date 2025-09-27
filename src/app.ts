import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';

// 路由导入
import { organizationRoutes } from './routes/organization.controller';
import { subscriptionRoutes } from './routes/subscription.controller';
import { webhookRoutes } from './routes/webhook.controller';
import { adminRoutes } from './routes/admin.controller';
import { microserviceUsageRoutes } from './routes/microserviceUsage.controller';
import frontendRoutes from './routes/frontend.js';
import microserviceRoutes from './routes/microservice.js';

export function createApp(): express.Application {
  const app = express();

  // CORS配置
  app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  }));

  // Webhook路由需要在JSON解析之前设置（raw body）
  app.use('/api/subscription-service/v1/webhooks', express.raw({ type: 'application/json' }), webhookRoutes);

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

  // API路由 - 版本化路径
  const apiRouter = express.Router();

  // 前端用户API（需要JWT认证）
  apiRouter.use('/frontend', frontendRoutes);

  // 内部订阅管理API
  apiRouter.use('/subscriptions', subscriptionRoutes);
  apiRouter.use('/organizations', organizationRoutes);

  // 微服务相关API
  apiRouter.use('/microservices', microserviceRoutes);
  apiRouter.use('/usage', microserviceUsageRoutes);

  // 管理员API（需要API Key）
  apiRouter.use('/admin', adminRoutes);

  // 挂载到版本化路径
  app.use('/api/subscription-service/v1', apiRouter);

  // 全局错误处理
  app.use(errorHandler);

  return app;
}