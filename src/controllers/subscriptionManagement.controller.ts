import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../types/index.js';
import { subscriptionService } from '../services/subscription.service.js';
import type {
  ActivateSubscriptionRequest,
  CancelSubscriptionRequest,
  UpdatePaymentMethodRequest,
  UpdateSmsBudgetRequest,
  AddModuleToSubscriptionRequest,
  AddResourceToSubscriptionRequest,
} from '../validators/subscription.validators.js';

/**
 * 订阅管理Controller (Part 2)
 * 处理前端用户的订阅管理请求
 */
export class SubscriptionManagementController {
  /**
   * API 1: 创建订阅 (智能检测)
   * POST /subscriptions/subscribe
   *
   * 智能检测Trial资格（per-user，一次性机会）：
   * - 首次订阅用户（未使用Trial）→ 创建TRIAL订阅（30天免费）
   * - 已使用Trial的用户 → 创建ACTIVE订阅（立即扣费）
   */
  async createTrial(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthenticatedRequest;
      const payerId = authReq.user.id;
      const requestData = req.body; // 支持两种格式：{ organizationIds } 或 { items }

      // 从JWT中获取用户的organizations列表
      const organizations = (authReq as any).user.organizations || [];

      const result = await subscriptionService.createTrial(requestData, payerId, organizations);

      res.status(201).json({
        success: true,
        data: result,
        message: `Subscriptions created successfully for ${result.subscriptions.length} organization(s). Redirecting to payment setup.`,
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * 新增 API: 计算订阅价格
   * POST /subscriptions/calculate
   */
  async calculatePrice(req: Request, res: Response): Promise<void> {
    try {
      const requestData = req.body; // { items, couponCode?, billingCycle? }

      const result = await subscriptionService.calculatePrice(requestData);

      res.status(200).json({
        success: true,
        data: result,
        message: result.message,
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * API 2: 激活订阅 (Trial → Active)
   * POST /subscriptions/activate
   * 返回Stripe Checkout URL供用户跳转支付
   */
  async activateSubscription(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthenticatedRequest;
      const payerId = authReq.user.id;
      const data = req.body as ActivateSubscriptionRequest;

      // 从JWT中获取用户的organizations列表
      const organizations = (authReq as any).user.organizations || [];

      const result = await subscriptionService.activateSubscription(payerId, data, organizations);

      res.status(200).json({
        success: true,
        data: result,
        message: result.message, // 使用Service层返回的message（支持测试模式和生产模式）
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * API 8: 取消订阅
   * POST /subscriptions/cancel
   */
  async cancelSubscription(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthenticatedRequest;
      const payerId = authReq.user.id;
      const data = req.body as CancelSubscriptionRequest;
      const { organizationId } = data;

      // 从JWT中获取用户的organizations列表
      const organizations = (authReq as any).user.organizations || [];

      // 权限验证：检查用户是否有权限管理该组织
      // JWT中organizations数组的每个元素使用 'id' 字段存储组织ID
      const hasPermission = organizations.some((org: any) => org.id === organizationId);

      if (!hasPermission) {
        res.status(403).json({
          success: false,
          error: {
            code: 'ORGANIZATION_NOT_FOUND',
            message: 'You do not have permission to manage this organization',
          },
        });
        return;
      }

      const result = await subscriptionService.cancelSubscription(organizationId, payerId, data);

      res.status(200).json({
        success: true,
        data: result,
        message: `Subscription cancelled successfully. Access until ${(result.accessInfo.accessUntil as Date).toLocaleDateString()}.`,
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * API 9: 重新激活订阅
   * POST /subscriptions/reactivate
   */
  async reactivateSubscription(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthenticatedRequest;
      const payerId = authReq.user.id;
      const data = req.body as ReactivateSubscriptionRequest;
      const { organizationId } = data;

      // 从JWT中获取用户的organizations列表
      const organizations = (authReq as any).user.organizations || [];

      // 权限验证：检查用户是否有权限管理该组织
      const hasPermission = organizations.some((org: any) => org.id === organizationId);

      if (!hasPermission) {
        res.status(403).json({
          success: false,
          error: {
            code: 'ORGANIZATION_NOT_FOUND',
            message: 'You do not have permission to manage this organization',
          },
        });
        return;
      }

      const result = await subscriptionService.reactivateSubscription(organizationId, payerId);

      res.status(200).json({
        success: true,
        data: result,
        message: 'Subscription reactivated successfully. All previous configurations restored.',
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * API 10: 更新支付方式
   * PUT /subscriptions/payment-method
   * 创建Stripe Billing Portal Session供用户跳转
   * 支付方式by user，一次更新应用到所有订阅
   */
  async updatePaymentMethod(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthenticatedRequest;
      const payerId = authReq.user.id;

      // 不需要organizationId，直接用payerId查找用户的订阅
      const result = await subscriptionService.updatePaymentMethod(payerId);

      res.status(200).json({
        success: true,
        data: result,
        message: 'Billing portal session created. Payment method changes will apply to all your subscriptions.',
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * API 11: 更新短信预算
   * PUT /subscriptions/sms-budget
   */
  async updateSmsBudget(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthenticatedRequest;
      const payerId = authReq.user.id;
      const data = req.body as UpdateSmsBudgetRequest;
      const { organizationId } = data;

      // 从JWT中获取用户的organizations列表
      const organizations = (authReq as any).user.organizations || [];

      // 权限验证：检查用户是否有权限管理该组织
      const hasPermission = organizations.some((org: any) => org.id === organizationId);

      if (!hasPermission) {
        res.status(403).json({
          success: false,
          error: {
            code: 'ORGANIZATION_NOT_FOUND',
            message: 'You do not have permission to manage this organization',
          },
        });
        return;
      }

      const result = await subscriptionService.updateSmsBudget(organizationId, payerId, data);

      res.status(200).json({
        success: true,
        data: result,
        message: 'SMS budget updated successfully',
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * API 7: 添加模块到订阅
   */
  async addModuleToSubscription(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthenticatedRequest;
      const payerId = authReq.user.id;
      const data = req.body as AddModuleToSubscriptionRequest;
      const { organizationId, moduleKey } = data;

      // 从JWT中获取用户的organizations列表
      const organizations = (authReq as any).user.organizations || [];

      // 权限验证：检查用户是否有权限管理该组织
      const hasPermission = organizations.some(
        (org: any) => org.id === organizationId || org.organizationId === organizationId
      );

      if (!hasPermission) {
        res.status(403).json({
          success: false,
          error: {
            code: 'ORGANIZATION_NOT_FOUND',
            message: 'You do not have permission to manage this organization',
          },
        });
        return;
      }

      const result = await subscriptionService.addModuleToSubscription(
        organizationId,
        payerId,
        { moduleKey }
      );

      res.status(200).json({
        success: true,
        data: result,
        message: 'Module added to subscription successfully',
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * API 8: 添加资源到订阅
   */
  async addResourceToSubscription(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthenticatedRequest;
      const payerId = authReq.user.id;
      const data = req.body as AddResourceToSubscriptionRequest;
      const { organizationId, resourceKey, quantity } = data;

      // 从JWT中获取用户的organizations列表
      const organizations = (authReq as any).user.organizations || [];

      // 权限验证：检查用户是否有权限管理该组织
      const hasPermission = organizations.some(
        (org: any) => org.id === organizationId || org.organizationId === organizationId
      );

      if (!hasPermission) {
        res.status(403).json({
          success: false,
          error: {
            code: 'ORGANIZATION_NOT_FOUND',
            message: 'You do not have permission to manage this organization',
          },
        });
        return;
      }

      const result = await subscriptionService.addResourceToSubscription(
        organizationId,
        payerId,
        { resourceKey, quantity }
      );

      res.status(200).json({
        success: true,
        data: result,
        message: 'Resource added to subscription successfully',
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
    if (error.code && error.code.startsWith('P')) {
      res.status(500).json({
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Database query error',
        },
      });
      return;
    }

    // 未知错误
    console.error('[SubscriptionManagementController] Unexpected error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error. Please try again later.',
      },
    });
  }
}

// 导出单例
export const subscriptionManagementController = new SubscriptionManagementController();
