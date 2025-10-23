import { Request, Response } from 'express';
import { resourcesService } from '../services/resources.service.js';
import {
  CreateResourceInput,
  UpdateResourceInput,
  UpdateResourceStatusInput,
  ListResourcesQuery,
} from '../validators/resources.validators.js';

/**
 * 资源管理Controller层
 * 负责处理HTTP请求和响应
 */

export class ResourcesController {
  /**
   * 创建资源
   * POST /api/subscription-service/v1/admin/resources
   */
  async createResource(req: Request, res: Response): Promise<void> {
    try {
      const data = req.body as CreateResourceInput;
      const resource = await resourcesService.createResource(data);

      res.status(200).json({
        success: true,
        data: resource,
        message: 'Resource created successfully',
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * 列出所有资源
   * GET /api/subscription-service/v1/admin/resources
   */
  async listResources(req: Request, res: Response): Promise<void> {
    try {
      const query = req.query as ListResourcesQuery;
      const result = await resourcesService.listResources(query);

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
   * 查询单个资源
   * GET /api/subscription-service/v1/admin/resources/:id
   */
  async getResource(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const resource = await resourcesService.getResourceById(id);

      res.status(200).json({
        success: true,
        data: resource,
        message: 'Query successful',
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * 更新资源
   * PATCH /api/subscription-service/v1/admin/resources/:id
   */
  async updateResource(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const data = req.body as UpdateResourceInput;
      const resource = await resourcesService.updateResource(id, data);

      res.status(200).json({
        success: true,
        data: resource,
        message: 'Resource updated successfully',
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * 删除资源(软删除)
   * DELETE /api/subscription-service/v1/admin/resources/:id
   */
  async deleteResource(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const resource = await resourcesService.deleteResource(id);

      res.status(200).json({
        success: true,
        data: resource,
        message: 'Resource marked as deprecated',
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * 更新资源状态
   * PATCH /api/subscription-service/v1/admin/resources/:id/status
   */
  async updateResourceStatus(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const data = req.body as UpdateResourceStatusInput;
      const result = await resourcesService.updateResourceStatus(id, data);

      res.status(200).json({
        success: true,
        data: result,
        message: 'Resource status updated',
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
          code: 'RESOURCE_TYPE_EXISTS',
          message: 'Resource type already exists',
        },
      });
      return;
    }

    // 未知错误
    console.error('[ResourcesController] Unexpected error:', error);
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
export const resourcesController = new ResourcesController();
