import { microservicePermissionService } from './microservicePermissionService.js';
import { logger } from '../utils/logger.js';

export class SchedulerService {
  private cleanupInterval: NodeJS.Timeout | null = null;

  // 启动定时任务
  start(): void {
    // 每10分钟清理一次过期的并发请求记录
    this.cleanupInterval = setInterval(async () => {
      try {
        await microservicePermissionService.cleanupExpiredConcurrentRequests();
      } catch (error) {
        logger.error('Scheduled cleanup task failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, 10 * 60 * 1000); // 10分钟

    logger.info('Scheduler started');
  }

  // 停止定时任务
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.info('Scheduler stopped');
    }
  }
}

export const schedulerService = new SchedulerService();