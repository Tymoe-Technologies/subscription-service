import { Request, Response, NextFunction } from 'express';
import { moduleService } from './moduleService.js';
import {
  CreateModuleParams,
  UpdateModuleParams,
  SyncModuleToStripeParams,
  ModuleQueryParams,
} from '../../../../types/admin.js';

/**
 * Module 控制器
 * 处理 HTTP 请求和响应
 */
export class ModuleController {
  /**
   * 创建 Module
   * POST /api/subscription-service/v1/admin/modules
   */
  createModule = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const params = req.body as CreateModuleParams;

      const module = await moduleService.createModule(params);

      res.status(201).json({
        success: true,
        message: 'Module created successfully',
        data: module,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * 获取所有 Modules
   * GET /api/subscription-service/v1/admin/modules
   */
  getAllModules = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const query = req.query as unknown as ModuleQueryParams;

      const result = await moduleService.getAllModules(query);

      res.status(200).json({
        success: true,
        message: 'Modules retrieved successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * 获取单个 Module
   * GET /api/subscription-service/v1/admin/modules/:id
   */
  getModuleById = async (
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
          detail: 'Module ID is required',
        });
        return;
      }

      const module = await moduleService.getModuleById(id);

      res.status(200).json({
        success: true,
        message: 'Module retrieved successfully',
        data: module,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * 更新 Module
   * PATCH /api/subscription-service/v1/admin/modules/:id
   */
  updateModule = async (
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
          detail: 'Module ID is required',
        });
        return;
      }

      const params = req.body as UpdateModuleParams;

      const module = await moduleService.updateModule(id, params);

      res.status(200).json({
        success: true,
        message: 'Module updated successfully',
        data: module,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * 同步 Module 到 Stripe
   * PATCH /api/subscription-service/v1/admin/modules/:id/sync-stripe
   */
  syncModuleToStripe = async (
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
          detail: 'Module ID is required',
        });
        return;
      }

      const params = req.body as SyncModuleToStripeParams;

      const module = await moduleService.syncModuleToStripe(id, params);

      res.status(200).json({
        success: true,
        message: 'Module synced to Stripe successfully',
        data: module,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * 删除 Module（软删除）
   * DELETE /api/subscription-service/v1/admin/modules/:id
   */
  deleteModule = async (
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
          detail: 'Module ID is required',
        });
        return;
      }

      await moduleService.deleteModule(id);

      res.status(200).json({
        success: true,
        message: 'Module deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  };
}

export const moduleController = new ModuleController();
