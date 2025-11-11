// TODO: 旧架构的microservicePermissionService已废弃,新架构下需要重新实现scheduler逻辑
// import { microservicePermissionService } from './microservicePermissionService.js';
import { logger } from '../utils/logger.js';

export class SchedulerService {
  private cleanupInterval: NodeJS.Timeout | null = null;

  // 启动定时任务
  start(): void {
    // TODO: 实现新架构下的定时任务
    // 可能需要的任务:
    // 1. 清理过期的Trial订阅
    // 2. 检查即将到期的订阅并发送提醒
    // 3. 处理宽限期结束的订阅
    // 4. 清理过期的suspended_resources记录

    // 暂时禁用旧的cleanup逻辑,避免启动失败
    // this.cleanupInterval = setInterval(async () => {
    //   try {
    //     await microservicePermissionService.cleanupExpiredConcurrentRequests();
    //   } catch (error) {
    //     logger.error('Scheduled cleanup task failed', {
    //       error: error instanceof Error ? error.message : String(error),
    //     });
    //   }
    // }, 10 * 60 * 1000); // 10分钟

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