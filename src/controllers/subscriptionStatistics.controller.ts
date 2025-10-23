import { Request, Response } from 'express';
import { subscriptionStatisticsService } from '../services/subscriptionStatistics.service.js';
import {
  StatisticsQuery,
  ListSubscriptionsQuery,
} from '../validators/subscriptionStatistics.validators.js';

/**
 * 订阅统计Controller层
 * 负责处理HTTP请求和响应
 */

export class SubscriptionStatisticsController {
  /**
   * 获取订阅统计数据
   * GET /api/subscription-service/v1/admin/statistics
   */
  async getStatistics(req: Request, res: Response): Promise<void> {
    try {
      const query = req.query as StatisticsQuery;
      const result = await subscriptionStatisticsService.getStatistics(query);

      res.status(200).json({
        success: true,
        data: result,
        message: 'Statistics query successful',
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * 列出订阅（分页、筛选、排序）
   * GET /api/subscription-service/v1/admin/subscriptions/list
   */
  async listSubscriptions(req: Request, res: Response): Promise<void> {
    try {
      const query = req.query as ListSubscriptionsQuery;
      const result = await subscriptionStatisticsService.listSubscriptions(query);

      res.status(200).json({
        success: true,
        data: result,
        message: 'Query successful',
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
    console.error('[SubscriptionStatisticsController] Unexpected error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error, please try again later',
      },
    });
  }
}

// 导出单例
export const subscriptionStatisticsController = new SubscriptionStatisticsController();
