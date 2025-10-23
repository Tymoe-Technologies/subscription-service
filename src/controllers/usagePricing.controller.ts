import { Request, Response } from 'express';
import { usagePricingService } from '../services/usagePricing.service.js';
import {
  CreateUsagePricingInput,
  UpdateUsagePricingInput,
  UpdateUsagePricingStatusInput,
  ListUsagePricingQuery,
} from '../validators/usagePricing.validators.js';

/**
 * 按量计费管理Controller层
 * 负责处理HTTP请求和响应
 */

export class UsagePricingController {
  /**
   * 创建按量计费规则
   * POST /api/subscription-service/v1/admin/usage-pricing
   */
  async createUsagePricing(req: Request, res: Response): Promise<void> {
    try {
      const data = req.body as CreateUsagePricingInput;
      const usagePricing = await usagePricingService.createUsagePricing(data);

      res.status(200).json({
        success: true,
        data: usagePricing,
        message: 'Usage pricing rule created successfully',
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * 列出所有按量计费规则
   * GET /api/subscription-service/v1/admin/usage-pricing
   */
  async listUsagePricing(req: Request, res: Response): Promise<void> {
    try {
      const query = req.query as ListUsagePricingQuery;
      const result = await usagePricingService.listUsagePricing(query);

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
   * 查询单个按量计费规则
   * GET /api/subscription-service/v1/admin/usage-pricing/:id
   */
  async getUsagePricing(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const usagePricing = await usagePricingService.getUsagePricingById(id);

      res.status(200).json({
        success: true,
        data: usagePricing,
        message: 'Query successful',
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * 更新按量计费规则
   * PATCH /api/subscription-service/v1/admin/usage-pricing/:id
   */
  async updateUsagePricing(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const data = req.body as UpdateUsagePricingInput;
      const usagePricing = await usagePricingService.updateUsagePricing(id, data);

      res.status(200).json({
        success: true,
        data: usagePricing,
        message: 'Usage pricing rule updated successfully',
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * 更新按量计费规则状态（启用/禁用）
   * PATCH /api/subscription-service/v1/admin/usage-pricing/:id/status
   */
  async updateUsagePricingStatus(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const data = req.body as UpdateUsagePricingStatusInput;
      const result = await usagePricingService.updateUsagePricingStatus(id, data);

      res.status(200).json({
        success: true,
        data: result,
        message: 'Usage pricing rule status updated',
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
    if (error.code === 'P2002') {
      res.status(409).json({
        success: false,
        error: {
          code: 'USAGE_TYPE_EXISTS',
          message: 'Usage type already exists',
        },
      });
      return;
    }

    // 未知错误
    console.error('[UsagePricingController] Unexpected error:', error);
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
export const usagePricingController = new UsagePricingController();
