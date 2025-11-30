import { Response, NextFunction } from 'express';
import { Request } from 'express';
import { SubscriptionService } from './subscriptionService.js';
import { CreateCheckoutRequestBody } from '../../../types/subscription.js';

/**
 * 订阅控制器
 * 处理 HTTP 请求和响应
 */
export class SubscriptionController {
  private subscriptionService: SubscriptionService;

  constructor() {
    this.subscriptionService = new SubscriptionService();
  }

  /**
   * 创建 Checkout Session
   * POST /api/subscription-service/v1/subscriptions/checkout
   */
  createCheckout = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      // 1. 提取参数
      const { orgId, planKey, moduleKeys } = req.body as CreateCheckoutRequestBody;
      const { userType, userId } = req.user || {};

      // 2. 检查必须是 USER token（不允许 ACCOUNT token 订阅）
      if (userType !== 'USER') {
        res.status(403).json({
          success: false,
          error: 'forbidden',
          detail: 'Only organization owners (USER accounts) can create subscriptions. ACCOUNT users (OWNER/MANAGER/STAFF) cannot subscribe.',
        });
        return;
      }

      if (!userId) {
        res.status(401).json({
          success: false,
          error: 'unauthorized',
          detail: 'User not authenticated',
        });
        return;
      }

      // 3. 调用 Service 层
      const result = await this.subscriptionService.createCheckoutSession({
        userId,
        orgId,
        planKey,
        moduleKeys: moduleKeys || [],
      });

      // 3. 返回成功响应
      res.status(200).json({
        success: true,
        message: 'Checkout session created successfully',
        data: {
          checkoutUrl: result.checkoutUrl,
          sessionId: result.sessionId,
          expiresAt: result.expiresAt.toISOString(),
        },
      });
    } catch (error) {
      // 4. 错误交给错误处理中间件
      next(error);
    }
  };

  /**
   * 获取订阅详情
   * GET /api/subscription-service/v1/subscriptions/:orgId
   */
  getSubscription = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      // 1. 提取路径参数
      const { orgId } = req.params;

      if (!orgId) {
        res.status(400).json({
          success: false,
          error: 'validation_error',
          detail: 'Organization ID is required',
        });
        return;
      }

      // 2. 调用 Service 层
      const subscription = await this.subscriptionService.getSubscriptionByOrgId(orgId);

      // 3. 返回成功响应
      res.status(200).json({
        success: true,
        message: 'Subscription retrieved successfully',
        data: {
          orgId: subscription.orgId,
          status: subscription.status,
          items: subscription.items,
          stripeSubscriptionId: subscription.stripeSubscriptionId,
          stripeCustomerId: subscription.stripeCustomerId,
          createdAt: subscription.createdAt.toISOString(),
          updatedAt: subscription.updatedAt.toISOString(),
        },
      });
    } catch (error) {
      // 4. 错误交给错误处理中间件
      next(error);
    }
  };

  /**
   * 创建 Billing Portal Session
   * POST /api/subscription-service/v1/subscriptions/:orgId/portal
   */
  createPortal = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      // 1. 提取路径参数和用户信息
      const { orgId } = req.params;
      const { userType } = req.user || {};

      // 2. 检查必须是 USER token（不允许 ACCOUNT token 访问 billing portal）
      if (userType !== 'USER') {
        res.status(403).json({
          success: false,
          error: 'forbidden',
          detail: 'Only organization owners (USER accounts) can access the billing portal.',
        });
        return;
      }

      if (!orgId) {
        res.status(400).json({
          success: false,
          error: 'validation_error',
          detail: 'Organization ID is required',
        });
        return;
      }

      // 3. 调用 Service 层
      const result = await this.subscriptionService.createBillingPortalSession({ orgId });

      // 3. 返回成功响应
      res.status(200).json({
        success: true,
        message: 'Billing portal session created successfully',
        data: {
          portalUrl: result.portalUrl,
        },
      });
    } catch (error) {
      // 4. 错误交给错误处理中间件
      next(error);
    }
  };
}
