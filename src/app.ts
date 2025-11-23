import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import catalogRoutes from './api/v1/catalog/catalogRoutes.js';
import subscriptionRoutes from './api/v1/subscriptions/subscriptionRoutes.js';
import planRoutes from './api/v1/admin/plans/planRoutes.js';
import moduleRoutes from './api/v1/admin/modules/moduleRoutes.js';
import queryRoutes from './api/v1/queries/queryRoutes.js';
import internalRoutes from './api/v1/internal/internalRoutes.js';
import webhookRoutes from './api/v1/webhooks/webhookRoutes.js';

export function createApp(): express.Application {
  const app = express();

  // CORS配置
  app.use(cors({
    origin: process.env.NODE_ENV === 'development'
      ? true  // 开发环境允许所有origin
      : (process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*'),
    credentials: true,
  }));

  // Stripe Webhook 需要 raw body（必须在 JSON parser 之前注册）
  // Stripe 签名验证需要原始请求体（Buffer）
  app.use(
    '/api/subscription-service/v1/webhooks/stripe',
    express.raw({ type: 'application/json' })
  );

  // JSON解析中间件（其他路由使用）
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

  // Part 1: 产品目录API（公开，无需认证）
  apiRouter.use('/catalog', catalogRoutes);

  // Part 2: 管理员API（产品管理）
  apiRouter.use('/admin/plans', planRoutes);
  apiRouter.use('/admin/modules', moduleRoutes);

  // Part 3: 订阅管理API（订阅操作）
  apiRouter.use('/subscriptions', subscriptionRoutes);

  // Part 4: 查询API（数据查询）
  apiRouter.use('/queries', queryRoutes);

  // Part 5: 内部API（内部微服务）
  apiRouter.use('/internal', internalRoutes);

  // Part 6: Webhook API（Stripe webhook）
  apiRouter.use('/webhooks', webhookRoutes);

  // 挂载到版本化路径
  app.use('/api/subscription-service/v1', apiRouter);

  // 全局错误处理
  app.use(errorHandler);

  return app;
}