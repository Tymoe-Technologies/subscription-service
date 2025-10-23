import { Request, Response } from 'express';
import { modulesService } from '../services/modules.service.js';
import {
  CreateModuleInput,
  UpdateModuleInput,
  UpdateModuleStatusInput,
  ListModulesQuery,
} from '../validators/modules.validators.js';

/**
 * 模块管理Controller层
 * 负责处理HTTP请求和响应
 */

export class ModulesController {
  /**
   * 创建模块
   * POST /api/subscription-service/v1/admin/modules
   */
  async createModule(req: Request, res: Response): Promise<void> {
    try {
      const data = req.body as CreateModuleInput;
      const module = await modulesService.createModule(data);

      res.status(200).json({
        success: true,
        data: module,
        message: 'Module created successfully',
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * 列出所有模块
   * GET /api/subscription-service/v1/admin/modules
   */
  async listModules(req: Request, res: Response): Promise<void> {
    try {
      const query = req.query as ListModulesQuery;
      const result = await modulesService.listModules(query);

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
   * 查询单个模块
   * GET /api/subscription-service/v1/admin/modules/:id
   */
  async getModule(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const module = await modulesService.getModuleById(id);

      res.status(200).json({
        success: true,
        data: module,
        message: 'Query successful',
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * 更新模块
   * PATCH /api/subscription-service/v1/admin/modules/:id
   */
  async updateModule(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const data = req.body as UpdateModuleInput;
      const module = await modulesService.updateModule(id, data);

      res.status(200).json({
        success: true,
        data: module,
        message: 'Module updated successfully',
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * 删除模块(软删除)
   * DELETE /api/subscription-service/v1/admin/modules/:id
   */
  async deleteModule(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const module = await modulesService.deleteModule(id);

      res.status(200).json({
        success: true,
        data: module,
        message: 'Module marked as deprecated',
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * 更新模块状态
   * PATCH /api/subscription-service/v1/admin/modules/:id/status
   */
  async updateModuleStatus(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const data = req.body as UpdateModuleStatusInput;
      const result = await modulesService.updateModuleStatus(id, data);

      res.status(200).json({
        success: true,
        data: result,
        message: 'Module status updated',
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
          code: 'MODULE_KEY_EXISTS',
          message: 'Module key already exists',
        },
      });
      return;
    }

    // 未知错误
    console.error('[ModulesController] Unexpected error:', error);
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
export const modulesController = new ModulesController();
