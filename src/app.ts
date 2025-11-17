import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';

export function createApp(): express.Application {
  const app = express();

  // CORS配置
  app.use(cors({
    origin: process.env.NODE_ENV === 'development'
      ? true  // 开发环境允许所有origin
      : (process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*'),
    credentials: true,
  }));

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

  // TODO: 新路由将在这里注册
  // Part 1: 管理员API（产品管理）
  // Part 2: 订阅管理API（订阅操作）
  // Part 3: 查询API（数据查询）
  // Part 4: 内部API（内部微服务）
  // Part 5: Webhook API（Stripe webhook）

  // 挂载到版本化路径
  app.use('/api/subscription-service/v1', apiRouter);

  // 全局错误处理
  app.use(errorHandler);

  return app;
}