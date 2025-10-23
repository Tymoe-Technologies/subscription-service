import { Request, Response } from 'express';
import { standardPlanService } from '../services/standardPlan.service.js';
import {
  CreateStandardPlanInput,
  UpdateStandardPlanInput,
  ListStandardPlanQuery,
} from '../validators/standardPlan.validators.js';

/**
 * Standard Plan管理Controller层
 * 负责处理HTTP请求和响应
 */

export class StandardPlanController {
  /**
   * 创建Standard Plan
   * POST /api/subscription-service/v1/admin/standard-plan
   */
  async createStandardPlan(req: Request, res: Response): Promise<void> {
    try {
      const data = req.body as CreateStandardPlanInput;
      const result = await standardPlanService.createStandardPlan(data);

      const message = data.activateImmediately
        ? 'Standard Plan created successfully and activated'
        : 'Standard Plan created successfully';

      res.status(200).json({
        success: true,
        data: result,
        message,
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * 查询当前ACTIVE的Standard Plan
   * GET /api/subscription-service/v1/admin/standard-plan
   */
  async getActiveStandardPlan(req: Request, res: Response): Promise<void> {
    try {
      const plan = await standardPlanService.getActiveStandardPlan();

      res.status(200).json({
        success: true,
        data: plan,
        message: 'Query successful',
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * 列出所有Standard Plan版本
   * GET /api/subscription-service/v1/admin/standard-plan/list
   */
  async listStandardPlans(req: Request, res: Response): Promise<void> {
    try {
      const query = req.query as ListStandardPlanQuery;
      const result = await standardPlanService.listStandardPlans(query);

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
   * 查询单个Standard Plan
   * GET /api/subscription-service/v1/admin/standard-plan/:id
   */
  async getStandardPlan(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const plan = await standardPlanService.getStandardPlanById(id);

      res.status(200).json({
        success: true,
        data: plan,
        message: 'Query successful',
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * 更新Standard Plan
   * PATCH /api/subscription-service/v1/admin/standard-plan/:id
   */
  async updateStandardPlan(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const data = req.body as UpdateStandardPlanInput;
      const result = await standardPlanService.updateStandardPlan(id, data);

      res.status(200).json({
        success: true,
        data: result,
        message: 'Standard Plan updated successfully',
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * 激活Standard Plan
   * PATCH /api/subscription-service/v1/admin/standard-plan/:id/activate
   */
  async activateStandardPlan(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const result = await standardPlanService.activateStandardPlan(id);

      res.status(200).json({
        success: true,
        data: result,
        message: 'Standard Plan activated',
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * 删除Standard Plan（软删除）
   * DELETE /api/subscription-service/v1/admin/standard-plan/:id
   */
  async deleteStandardPlan(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const result = await standardPlanService.deleteStandardPlan(id);

      res.status(200).json({
        success: true,
        data: result,
        message: 'Standard Plan deleted',
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

    // Prisma错误处理 - 唯一性约束冲突
    if (error.code === 'P2002') {
      // 检查是哪个字段冲突
      const target = error.meta?.target;

      if (target?.includes('version')) {
        res.status(409).json({
          success: false,
          error: {
            code: 'VERSION_ALREADY_EXISTS',
            message: 'Version already exists, please use a different version',
          },
        });
        return;
      }

      // 其他唯一性冲突
      res.status(409).json({
        success: false,
        error: {
          code: 'STANDARD_PLAN_EXISTS',
          message: 'Standard Plan already exists',
        },
      });
      return;
    }

    // 未知错误
    console.error('[StandardPlanController] Unexpected error:', error);
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
export const standardPlanController = new StandardPlanController();
