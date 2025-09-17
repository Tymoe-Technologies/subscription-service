import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/jwt.js';
import { organizationService } from '../services/organization.js';
import { subscriptionService } from '../services/subscription.js';
import { hasFeatureAccess, getTierFeatures } from '../config/features.js';
import { logger } from '../utils/logger.js';

// 获取组织的订阅状态（前端缓存用）
export async function getOrganizationSubscriptionStatus(req: Request, res: Response): Promise<void> {
  try {
    const { organizationId } = req.params;
    const userId = (req as AuthenticatedRequest).user.id;

    // 获取组织信息
    const organization = await organizationService.getOrganization(organizationId!);
    if (!organization) {
      res.status(404).json({
        error: 'organization_not_found',
        message: '店铺不存在',
      });
      return;
    }

    // 获取组织的所有订阅
    const subscriptions = await subscriptionService.getOrganizationSubscriptions(organizationId!);

    // 构建前端需要的订阅状态信息
    const subscriptionStatus = {
      organizationId,
      organizationName: organization.name,
      subscriptions: subscriptions.map(sub => ({
        id: sub.id,
        productKey: sub.productKey,
        tier: sub.tier,
        status: sub.status,
        currentPeriodStart: sub.currentPeriodStart,
        currentPeriodEnd: sub.currentPeriodEnd,
        trialEnd: sub.trialEnd,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        features: getTierFeatures(sub.productKey, sub.tier),
      })),
      lastUpdated: new Date().toISOString(),
    };

    logger.info('获取组织订阅状态成功', {
      userId,
      organizationId,
      subscriptionCount: subscriptions.length,
    });

    res.json({
      success: true,
      data: subscriptionStatus,
    });
  } catch (error) {
    logger.error('获取组织订阅状态失败', {
      organizationId: req.params.organizationId,
      userId: (req as AuthenticatedRequest).user.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    res.status(500).json({
      error: 'server_error',
      message: '获取订阅状态失败',
    });
  }
}

// 检查单个功能权限
export async function checkFeatureAccess(req: Request, res: Response): Promise<void> {
  try {
    const { organizationId, productKey, featureKey } = req.params;
    const userId = (req as AuthenticatedRequest).user.id;

    if (!productKey || !['ploml', 'mopai'].includes(productKey)) {
      res.status(400).json({
        error: 'invalid_product',
        message: '无效的产品类型',
      });
      return;
    }

    // 获取组织的该产品订阅
    const subscription = await subscriptionService.getOrganizationSubscription(organizationId!, productKey!);

    let hasAccess = false;
    let currentTier = 'none';

    if (subscription && ['trialing', 'active'].includes(subscription.status)) {
      currentTier = subscription.tier;
      hasAccess = hasFeatureAccess(productKey!, subscription.tier, featureKey!);
    }

    logger.debug('功能权限检查', {
      userId,
      organizationId,
      productKey,
      featureKey,
      currentTier,
      hasAccess,
    });

    res.json({
      success: true,
      data: {
        hasAccess,
        currentTier,
        featureKey,
        requiresTier: null, // 可以后续添加功能所需的最低等级
      },
    });
  } catch (error) {
    logger.error('功能权限检查失败', {
      organizationId: req.params.organizationId,
      productKey: req.params.productKey,
      featureKey: req.params.featureKey,
      userId: (req as AuthenticatedRequest).user.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    res.status(500).json({
      error: 'server_error',
      message: '权限检查失败',
    });
  }
}

// 获取产品的定价信息
export async function getProductPricing(req: Request, res: Response): Promise<void> {
  try {
    const { productKey } = req.params;
    const userId = (req as AuthenticatedRequest).user.id;

    if (!productKey || !['ploml', 'mopai'].includes(productKey)) {
      res.status(400).json({
        error: 'invalid_product',
        message: '无效的产品类型',
      });
      return;
    }

    // 暂时返回空的定价信息，因为subscriptionService还没有getProductPricing方法
    const pricing: any[] = [];

    logger.debug('获取产品定价', {
      userId,
      productKey,
      pricingCount: pricing.length,
    });

    res.json({
      success: true,
      data: {
        productKey,
        pricing,
      },
    });
  } catch (error) {
    logger.error('获取产品定价失败', {
      productKey: req.params.productKey,
      userId: (req as AuthenticatedRequest).user.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    res.status(500).json({
      error: 'server_error',
      message: '获取定价信息失败',
    });
  }
}

// 获取用户拥有的所有组织的订阅概览
export async function getUserOrganizationsOverview(req: Request, res: Response): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.id;

    // 这个端点需要调用auth-service获取用户的所有组织
    // 然后获取每个组织的订阅状态
    // 暂时返回提示信息，因为需要auth-service配合

    res.json({
      success: true,
      message: '此功能需要配合auth-service实现',
      data: {
        organizations: [],
      },
    });
  } catch (error) {
    logger.error('获取用户组织概览失败', {
      userId: (req as AuthenticatedRequest).user.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    res.status(500).json({
      error: 'server_error',
      message: '获取组织概览失败',
    });
  }
}