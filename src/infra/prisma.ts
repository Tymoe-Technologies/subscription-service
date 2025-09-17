import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';
import { service } from '../config/config.js';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: service.nodeEnv === 'development' ? ['query', 'error', 'warn'] : ['error'],
    datasources: {
      db: {
        url: service.database.url,
      },
    },
  });

if (service.nodeEnv !== 'production') {
  globalForPrisma.prisma = prisma;
}

// 数据库连接健康检查
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logger.error('数据库连接失败:', error);
    return false;
  }
}

// 优雅关闭数据库连接
export async function closeDatabaseConnection(): Promise<void> {
  await prisma.$disconnect();
}
