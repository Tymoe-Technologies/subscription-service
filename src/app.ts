import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';

// Part 5: Webhook路由导入（需要在JSON解析之前设置）
// 暂时注释调试
// import { webhookRoutes } from './routes/webhook.routes.js';

// 其他路由导入
// 旧路由（暂时注释，使用旧schema）
// import { organizationRoutes } from './routes/organization.controller';
// import { subscriptionRoutes } from './routes/subscription.controller';
// import { microserviceUsageRoutes } from './routes/microserviceUsage.controller';
// import frontendRoutes from './routes/frontend.js';
// import microserviceRoutes from './routes/microservice.js';
// import adminRoutes from './routes/admin/index.js';

// 新路由（Part 1-5，使用新schema）
import subscriptionManagementRoutes from './routes/subscriptionManagement.routes.js';
// import queryRoutes from './routes/query.routes.js';
// import internalRoutes from './routes/internal.routes.js';
import adminRoutes from './routes/admin/index.js'; // Part 1 管理员API

export function createApp(): express.Application {
  const app = express();

  // CORS配置
  app.use(cors({
    origin: process.env.NODE_ENV === 'development'
      ? true  // 开发环境允许所有origin
      : (process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*'),
    credentials: true,
  }));

  // Webhook路由需要在JSON解析之前设置（raw body）
  // 暂时注释调试
  // app.use('/api/subscription-service/v1/webhooks', express.raw({ type: 'application/json' }), webhookRoutes);

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

  // ========== 新架构 API（Part 1-5） ==========

  // Part 1: 管理员API（需要Admin API Key）
  apiRouter.use('/admin', adminRoutes);

  // Part 2: 订阅管理API（需要JWT认证，userType=USER）
  apiRouter.use('/subscriptions', subscriptionManagementRoutes);

  // Part 3: 查询API（需要JWT认证，userType=USER）
  // apiRouter.use('/queries', queryRoutes);

  // Part 4: 内部API（需要Service API Key）
  // apiRouter.use('/internal', internalRoutes);

  // Part 5: Webhook API（已在app级别挂载，使用raw body）

  // ========== 旧架构 API（暂时注释） ==========
  // apiRouter.use('/frontend', frontendRoutes);
  // apiRouter.use('/organizations', organizationRoutes);
  // apiRouter.use('/microservices', microserviceRoutes);
  // apiRouter.use('/usage', microserviceUsageRoutes);

  // 挂载到版本化路径
  app.use('/api/subscription-service/v1', apiRouter);

  // 全局错误处理
  app.use(errorHandler);

  return app;
}