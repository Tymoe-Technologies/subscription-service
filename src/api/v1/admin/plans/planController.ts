import { Request, Response, NextFunction } from 'express';
import { planService } from './planService.js';
import {
  CreatePlanParams,
  UpdatePlanParams,
  SyncPlanToStripeParams,
  PlanQueryParams,
} from '../../../../types/admin.js';

/**
 * Plan 控制器
 * 处理 HTTP 请求和响应
 */
export class PlanController {
  /**
   * 创建 Plan
   * POST /api/subscription-service/v1/admin/plans
   */
  createPlan = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const params = req.body as CreatePlanParams;

      const plan = await planService.createPlan(params);

      res.status(201).json({
        success: true,
        message: 'Plan created successfully',
        data: plan,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * 获取所有 Plans
   * GET /api/subscription-service/v1/admin/plans
   */
  getAllPlans = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const query = req.query as unknown as PlanQueryParams;

      const result = await planService.getAllPlans(query);

      res.status(200).json({
        success: true,
        message: 'Plans retrieved successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * 获取单个 Plan
   * GET /api/subscription-service/v1/admin/plans/:id
   */
  getPlanById = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(400).json({
          success: false,
          error: 'validation_error',
          detail: 'Plan ID is required',
        });
        return;
      }

      const plan = await planService.getPlanById(id);

      res.status(200).json({
        success: true,
        message: 'Plan retrieved successfully',
        data: plan,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * 更新 Plan
   * PATCH /api/subscription-service/v1/admin/plans/:id
   */
  updatePlan = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(400).json({
          success: false,
          error: 'validation_error',
          detail: 'Plan ID is required',
        });
        return;
      }

      const params = req.body as UpdatePlanParams;

      const plan = await planService.updatePlan(id, params);

      res.status(200).json({
        success: true,
        message: 'Plan updated successfully',
        data: plan,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * 同步 Plan 到 Stripe
   * PATCH /api/subscription-service/v1/admin/plans/:id/sync-stripe
   */
  syncPlanToStripe = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(400).json({
          success: false,
          error: 'validation_error',
          detail: 'Plan ID is required',
        });
        return;
      }

      const params = req.body as SyncPlanToStripeParams;

      const plan = await planService.syncPlanToStripe(id, params);

      res.status(200).json({
        success: true,
        message: 'Plan synced to Stripe successfully',
        data: plan,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * 删除 Plan
   * DELETE /api/subscription-service/v1/admin/plans/:id
   */
  deletePlan = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(400).json({
          success: false,
          error: 'validation_error',
          detail: 'Plan ID is required',
        });
        return;
      }

      await planService.deletePlan(id);

      res.status(200).json({
        success: true,
        message: 'Plan deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  };
}

export const planController = new PlanController();
