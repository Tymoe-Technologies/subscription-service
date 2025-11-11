import { Request, Response } from 'express';
import { internalService } from '../services/internal.service.js';
import type {
  CheckQuotaRequest,
  CheckAccessRequest,
  SuspendResourceRequest,
  RestoreResourceRequest,
  RecordUsageRequest,
  BatchRecordUsageRequest,
  StatsActiveResourcesRequest,
} from '../validators/internal.validators.js';

/**
 * Part 4: 内部API - Controller层
 * 处理微服务间的内部API请求
 */
export class InternalController {
  /**
   * API 1: 检查资源配额
   * POST /internal/quota/check
   */
  async checkQuota(req: Request, res: Response): Promise<void> {
    try {
      const data = req.body as CheckQuotaRequest;
      const result = await internalService.checkQuota(data);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * API 2: 检查访问权限
   * POST /internal/access/check
   */
  async checkAccess(req: Request, res: Response): Promise<void> {
    try {
      const data = req.body as CheckAccessRequest;
      const result = await internalService.checkAccess(data);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * API 3: 暂停资源
   * POST /internal/resources/suspend
   */
  async suspendResource(req: Request, res: Response): Promise<void> {
    try {
      const data = req.body as SuspendResourceRequest;
      const result = await internalService.suspendResource(data);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * API 4: 恢复资源
   * POST /internal/resources/restore
   */
  async restoreResource(req: Request, res: Response): Promise<void> {
    try {
      const data = req.body as RestoreResourceRequest;
      const result = await internalService.restoreResource(data);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * API 5: 记录使用量
   * POST /internal/usage/record
   */
  async recordUsage(req: Request, res: Response): Promise<void> {
    try {
      const data = req.body as RecordUsageRequest;
      const result = await internalService.recordUsage(data);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * API 6: 批量记录使用量
   * POST /internal/usage/batch
   */
  async batchRecordUsage(req: Request, res: Response): Promise<void> {
    try {
      const data = req.body as BatchRecordUsageRequest;
      const result = await internalService.batchRecordUsage(data);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * API 7: 统计活跃资源
   * POST /internal/stats/active-resources
   */
  async statsActiveResources(req: Request, res: Response): Promise<void> {
    try {
      const data = req.body as StatsActiveResourcesRequest;
      const result = await internalService.statsActiveResources(data);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * 统一错误处理
   */
  private handleError(res: Response, error: any): void {
    // 如果是业务异常(从Service层抛出的)
    if (error.code && error.statusCode) {
      res.status(error.statusCode).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details && { details: error.details }),
        },
      });
      return;
    }

    // Prisma错误处理
    if (error.code && error.code.startsWith('P')) {
      res.status(500).json({
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Database query error',
        },
      });
      return;
    }

    // 未知错误
    console.error('[InternalController] Unexpected error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error. Please try again later.',
      },
    });
  }
}

// 导出单例
export const internalController = new InternalController();
