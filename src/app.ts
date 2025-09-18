import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { service } from './config/config.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';

// 路由导入
import subscriptionRoutes from './routes/subscription.js';
import organizationRoutes from './routes/organization.js';
import webhookRoutes from './routes/webhook.js';
import frontendRoutes from './routes/frontend.js';
import microserviceRoutes from './routes/microservice.js';

export function createApp(): express.Application {
  const app = express();

  // 安全中间件
  app.use(helmet());
  
  // CORS配置
  app.use(cors({
    origin: service.security.corsOrigin,
    credentials: true,
  }));

  // Webhook路由需要在JSON解析之前设置
  app.use('/api/subscription-service/v1/webhooks', webhookRoutes);

  // JSON解析中间件
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // 健康检查
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      service: service.name,
      version: service.version,
      timestamp: new Date().toISOString(),
    });
  });

  // API路由 - 服务间调用（需要内部API密钥）
  app.use('/api/subscription-service/v1/admin/subscriptions', subscriptionRoutes);
  app.use('/api/subscription-service/v1/admin/organizations', organizationRoutes);

  // API路由 - 前端调用（需要用户JWT）
  app.use('/api/subscription-service/v1', frontendRoutes);

  // 微服务权限管理路由
  app.use('/api/subscription-service/v1/microservices', microserviceRoutes);

  // 404处理
  app.use(notFoundHandler);

  // 全局错误处理
  app.use(errorHandler);

  return app;
}