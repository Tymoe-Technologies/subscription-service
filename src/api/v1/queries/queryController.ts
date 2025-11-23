import { Request, Response, NextFunction } from 'express';
import { queryService } from './queryService.js';

/**
 * 查询控制器
 * 处理 HTTP 请求和响应
 */
export class QueryController {
  /**
   * 获取组织订阅详情
   * GET /api/subscription-service/v1/queries/orgs/:orgId/subscription
   */
  getOrgSubscription = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { orgId } = req.params;
      // X-User-ID header 现在是可选的
      const userId = req.headers['x-user-id'] as string | undefined;

      // 验证 orgId
      if (!orgId) {
        res.status(400).json({
          success: false,
          error: 'validation_error',
          detail: 'Organization ID is required',
        });
        return;
      }

      const result = await queryService.getOrgSubscriptionDetails(orgId, userId);

      res.status(200).json({
        success: true,
        message: 'Organization subscription retrieved successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };
}

export const queryController = new QueryController();
