import { createApp } from './app.js';
import { checkDatabaseHealth, closeDatabaseConnection } from './infra/prisma.js';
import { createRedisClient, closeRedisConnection } from './infra/redis.js';
import { logger } from './utils/logger.js';

export async function startServer(port: number): Promise<void> {
  // 检查数据库连接
  const dbHealthy = await checkDatabaseHealth();
  if (!dbHealthy) {
    throw new Error('数据库连接失败');
  }
  logger.info('数据库连接正常');

  // 初始化Redis连接
  try {
    const redis = createRedisClient();
    await redis.connect();
    logger.info('Redis连接正常');
  } catch (error) {
    logger.warn('Redis连接失败，将继续运行但缓存功能不可用', { error });
  }

  // 创建Express应用
  const app = createApp();

  // 启动服务器
  const server = app.listen(port, () => {
    logger.info(`订阅服务启动成功`, {
      port,
      environment: process.env.NODE_ENV,
    });
  });

  // 优雅关闭处理
  const gracefulShutdown = async (signal: string) => {
    logger.info(`收到${signal}信号，开始优雅关闭...`);

    server.close(() => {
      void (async () => {
        logger.info('HTTP服务器已关闭');

        try {
          await closeDatabaseConnection();
          logger.info('数据库连接已关闭');
        } catch (error) {
          logger.error('关闭数据库连接失败', { error });
        }

        try {
          await closeRedisConnection();
          logger.info('Redis连接已关闭');
        } catch (error) {
          logger.error('关闭Redis连接失败', { error });
        }

        process.exit(0);
      })();
    });

    // 强制退出（如果优雅关闭超时）
    setTimeout(() => {
      logger.error('优雅关闭超时，强制退出');
      process.exit(1);
    }, 10000);

    // 等待关闭完成
    await new Promise(resolve => setTimeout(resolve, 100));
  };

  // 监听关闭信号
  process.on('SIGTERM', () => {
    void gracefulShutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void gracefulShutdown('SIGINT');
  });
}