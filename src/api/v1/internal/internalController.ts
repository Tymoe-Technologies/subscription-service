import { Request, Response, NextFunction } from 'express';
import { internalService } from './internalService.js';

/**
 * 内部 API 控制器
 * 处理微服务间调用的 HTTP 请求
 */
export class InternalController {
  /**
   * 获取组织模块配额
   * GET /api/subscription-service/v1/internal/org/:orgId/module-quotas
   */
  getOrgModuleQuotas = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { orgId } = req.params;

      // 验证 orgId
      if (!orgId) {
        res.status(400).json({
          success: false,
          error: 'validation_error',
          detail: 'Organization ID is required',
        });
        return;
      }

      const result = await internalService.getOrgModuleQuotas(orgId);

      // 根据是否有订阅返回不同的消息
      const message =
        result.subscriptionStatus === 'none'
          ? 'No active subscription found'
          : 'Module quotas retrieved successfully';

      res.status(200).json({
        success: true,
        message,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };
}

export const internalController = new InternalController();
