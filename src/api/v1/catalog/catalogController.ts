import { Request, Response, NextFunction } from 'express';
import { catalogService } from './catalogService.js';

/**
 * Catalog Controller
 * 处理公开的产品目录查询（无需认证）
 */
class CatalogController {
  /**
   * 获取所有可用的 Plans
   * GET /api/subscription-service/v1/catalog/plans
   */
  getPlans = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const plans = await catalogService.getActivePlans();

      res.status(200).json({
        success: true,
        message: 'Plans retrieved successfully',
        data: {
          plans,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * 根据 key 获取单个 Plan
   * GET /api/subscription-service/v1/catalog/plans/:key
   */
  getPlanByKey = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { key } = req.params;

      if (!key) {
        res.status(400).json({
          success: false,
          error: 'validation_error',
          detail: 'Plan key is required',
        });
        return;
      }

      const plan = await catalogService.getPlanByKey(key);

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
   * 获取所有可用的 Modules
   * GET /api/subscription-service/v1/catalog/modules
   */
  getModules = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const modules = await catalogService.getActiveModules();

      res.status(200).json({
        success: true,
        message: 'Modules retrieved successfully',
        data: {
          modules,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * 根据 key 获取单个 Module
   * GET /api/subscription-service/v1/catalog/modules/:key
   */
  getModuleByKey = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { key } = req.params;

      if (!key) {
        res.status(400).json({
          success: false,
          error: 'validation_error',
          detail: 'Module key is required',
        });
        return;
      }

      const module = await catalogService.getModuleByKey(key);

      res.status(200).json({
        success: true,
        message: 'Module retrieved successfully',
        data: module,
      });
    } catch (error) {
      next(error);
    }
  };
}

export const catalogController = new CatalogController();
