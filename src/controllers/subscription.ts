import { Request, Response } from 'express';
import { subscriptionService } from '../services/subscription.js';
import { hasFeatureAccess, getTierFeatures, subscriptionTiers } from '../config/features.js';
import { prisma } from '../infra/prisma.js';
import { logger } from '../utils/logger.js';

// 创建试用订阅
export async function createTrialSubscription(req: Request, res: Response): Promise<void> {
  try {
    const { organizationId, productKey } = req.body;

    if (!organizationId || !productKey) {
      res.status(400).json({
        error: 'bad_request',
        message: 'organizationId 和 productKey 是必需的',
      });
      return;
    }

    if (!['ploml', 'mopai'].includes(productKey)) {
      res.status(400).json({
        error: 'invalid_product',
        message: '产品类型必须是 ploml 或 mopai',
      });
      return;
    }

    const subscription = await subscriptionService.createTrialSubscription({
      organizationId,
      productKey,
    });

    res.status(201).json({
      success: true,
      data: {
        subscription,
        trialPeriodDays: 30,
        features: getTierFeatures(productKey, 'trial'),
      },
    });
  } catch (error: unknown) {
    logger.error('创建试用订阅失败:', error);

    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('已经使用过试用期') || errorMessage.includes('已有')) {
      res.status(409).json({
        error: 'conflict',
        message: errorMessage,
      });
      return;
    }

    res.status(500).json({
      error: 'server_error',
      message: '创建试用订阅失败',
    });
  }
}

// 创建付费订阅
export async function createPaidSubscription(req: Request, res: Response): Promise<void> {
  try {
    const { organizationId, productKey, tier, billingCycle, successUrl, cancelUrl } = req.body;

    if (!organizationId || !productKey || !tier || !billingCycle || !successUrl || !cancelUrl) {
      res.status(400).json({
        error: 'bad_request',
        message: '缺少必需参数',
      });
      return;
    }

    if (!['ploml', 'mopai'].includes(productKey)) {
      res.status(400).json({
        error: 'invalid_product',
        message: '产品类型必须是 ploml 或 mopai',
      });
      return;
    }

    if (!['basic', 'standard', 'advanced', 'pro'].includes(tier)) {
      res.status(400).json({
        error: 'invalid_tier',
        message: '套餐类型必须是 basic, standard, advanced 或 pro',
      });
      return;
    }

    if (!['monthly', 'yearly'].includes(billingCycle)) {
      res.status(400).json({
        error: 'invalid_billing_cycle',
        message: '计费周期必须是 monthly 或 yearly',
      });
      return;
    }

    const result = await subscriptionService.createPaidSubscription({
      organizationId,
      productKey,
      tier,
      billingCycle,
      successUrl,
      cancelUrl,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error: unknown) {
    logger.error('创建付费订阅失败:', error);

    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('不存在') || errorMessage.includes('找不到')) {
      res.status(404).json({
        error: 'not_found',
        message: errorMessage,
      });
      return;
    }

    res.status(500).json({
      error: 'server_error',
      message: '创建付费订阅失败',
    });
  }
}

// 升级订阅
export async function upgradeSubscription(req: Request, res: Response): Promise<void> {
  try {
    const subscriptionId = req.params.subscriptionId;
    const { newTier, billingCycle } = req.body;

    if (!subscriptionId) {
      res.status(400).json({
        error: 'bad_request',
        message: 'subscriptionId 是必需的',
      });
      return;
    }

    if (!newTier) {
      res.status(400).json({
        error: 'bad_request',
        message: 'newTier 是必需的',
      });
      return;
    }

    if (!['basic', 'standard', 'advanced', 'pro'].includes(newTier)) {
      res.status(400).json({
        error: 'invalid_tier',
        message: '套餐类型必须是 basic, standard, advanced 或 pro',
      });
      return;
    }

    if (billingCycle && !['monthly', 'yearly'].includes(billingCycle)) {
      res.status(400).json({
        error: 'invalid_billing_cycle',
        message: '计费周期必须是 monthly 或 yearly',
      });
      return;
    }

    const subscription = await subscriptionService.upgradeSubscription({
      subscriptionId,
      newTier,
      billingCycle,
    });

    res.json({
      success: true,
      data: {
        subscription,
        features: getTierFeatures(subscription.productKey, newTier),
      },
    });
  } catch (error: unknown) {
    logger.error('升级订阅失败:', error);

    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('不存在') || errorMessage.includes('找不到')) {
      res.status(404).json({
        error: 'not_found',
        message: errorMessage,
      });
      return;
    }

    if (errorMessage.includes('只允许升级') || errorMessage.includes('只能升级')) {
      res.status(400).json({
        error: 'invalid_operation',
        message: errorMessage,
      });
      return;
    }

    res.status(500).json({
      error: 'server_error',
      message: '升级订阅失败',
    });
  }
}

// 取消订阅
export async function cancelSubscription(req: Request, res: Response): Promise<void> {
  try {
    const subscriptionId = req.params.subscriptionId;
    const { cancelAtPeriodEnd = true } = req.body;

    if (!subscriptionId) {
      res.status(400).json({
        error: 'bad_request',
        message: 'subscriptionId 是必需的',
      });
      return;
    }

    const subscription = await subscriptionService.cancelSubscription(
      subscriptionId,
      cancelAtPeriodEnd
    );

    res.json({
      success: true,
      data: { subscription },
      message: cancelAtPeriodEnd ? '订阅将在当前计费周期结束时取消' : '订阅已立即取消',
    });
  } catch (error: unknown) {
    logger.error('取消订阅失败:', error);

    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('不存在')) {
      res.status(404).json({
        error: 'not_found',
        message: errorMessage,
      });
      return;
    }

    res.status(500).json({
      error: 'server_error',
      message: '取消订阅失败',
    });
  }
}

// 获取订阅详情
export async function getSubscription(req: Request, res: Response): Promise<void> {
  try {
    const subscriptionId = req.params.subscriptionId;

    if (!subscriptionId) {
      res.status(400).json({
        error: 'bad_request',
        message: 'subscriptionId 是必需的',
      });
      return;
    }

    const subscription = await subscriptionService.getSubscription(subscriptionId);

    if (!subscription) {
      res.status(404).json({
        error: 'not_found',
        message: '订阅不存在',
      });
      return;
    }

    res.json({
      success: true,
      data: {
        subscription,
        features: getTierFeatures(subscription.productKey, subscription.tier),
      },
    });
  } catch (error: unknown) {
    logger.error('获取订阅详情失败:', error);
    res.status(500).json({
      error: 'server_error',
      message: '获取订阅详情失败',
    });
  }
}

// 获取组织的订阅
export async function getOrganizationSubscription(req: Request, res: Response): Promise<void> {
  try {
    const organizationId = req.params.organizationId;
    const productKey = req.params.productKey;

    if (!organizationId || !productKey) {
      res.status(400).json({
        error: 'bad_request',
        message: 'organizationId 和 productKey 是必需的',
      });
      return;
    }

    if (!['ploml', 'mopai'].includes(productKey)) {
      res.status(400).json({
        error: 'invalid_product',
        message: '产品类型必须是 ploml 或 mopai',
      });
      return;
    }

    const subscription = await subscriptionService.getOrganizationSubscription(
      organizationId,
      productKey
    );

    if (!subscription) {
      res.status(404).json({
        error: 'not_found',
        message: '订阅不存在',
      });
      return;
    }

    res.json({
      success: true,
      data: {
        subscription,
        features: getTierFeatures(productKey, subscription.tier),
        isActive: await subscriptionService.isSubscriptionActive(organizationId, productKey),
      },
    });
  } catch (error: unknown) {
    logger.error('获取组织订阅失败:', error);
    res.status(500).json({
      error: 'server_error',
      message: '获取组织订阅失败',
    });
  }
}

// 获取组织的所有订阅
export async function getOrganizationSubscriptions(req: Request, res: Response): Promise<void> {
  try {
    const organizationId = req.params.organizationId;

    if (!organizationId) {
      res.status(400).json({
        error: 'bad_request',
        message: 'organizationId 是必需的',
      });
      return;
    }

    const subscriptions = await subscriptionService.getOrganizationSubscriptions(organizationId);
    const summary = await subscriptionService.getSubscriptionSummary(organizationId);

    res.json({
      success: true,
      data: {
        subscriptions,
        summary,
        availableProducts: ['ploml', 'mopai'],
        tiers: subscriptionTiers,
      },
    });
  } catch (error: unknown) {
    logger.error('获取组织订阅列表失败:', error);
    res.status(500).json({
      error: 'server_error',
      message: '获取组织订阅列表失败',
    });
  }
}

// 检查功能权限
export async function checkFeatureAccess(req: Request, res: Response): Promise<void> {
  try {
    const organizationId = req.params.organizationId;
    const productKey = req.params.productKey;
    const featureKey = req.params.featureKey;

    if (!organizationId || !productKey || !featureKey) {
      res.status(400).json({
        error: 'bad_request',
        message: 'organizationId, productKey 和 featureKey 是必需的',
      });
      return;
    }

    if (!['ploml', 'mopai'].includes(productKey)) {
      res.status(400).json({
        error: 'invalid_product',
        message: '产品类型必须是 ploml 或 mopai',
      });
      return;
    }

    const subscription = await subscriptionService.getOrganizationSubscription(
      organizationId,
      productKey
    );

    if (!subscription) {
      res.json({
        success: true,
        data: {
          hasAccess: false,
          reason: 'no_subscription',
          message: '没有订阅',
        },
      });
      return;
    }

    const isActive = await subscriptionService.isSubscriptionActive(organizationId, productKey);
    if (!isActive) {
      res.json({
        success: true,
        data: {
          hasAccess: false,
          reason: 'subscription_inactive',
          message: '订阅不活跃',
        },
      });
      return;
    }

    const hasAccess = hasFeatureAccess(productKey, subscription.tier, featureKey);

    res.json({
      success: true,
      data: {
        hasAccess,
        tier: subscription.tier,
        reason: hasAccess ? 'granted' : 'tier_restriction',
        message: hasAccess ? '有权限' : '当前套餐不支持该功能',
      },
    });
  } catch (error: unknown) {
    logger.error('检查功能权限失败:', error);
    res.status(500).json({
      error: 'server_error',
      message: '检查功能权限失败',
    });
  }
}

// 获取套餐定价
export async function getPricing(req: Request, res: Response): Promise<void> {
  try {
    const productKey = req.params.productKey;

    if (!productKey) {
      res.status(400).json({
        error: 'bad_request',
        message: 'productKey 是必需的',
      });
      return;
    }

    if (!['ploml', 'mopai'].includes(productKey)) {
      res.status(400).json({
        error: 'invalid_product',
        message: '产品类型必须是 ploml 或 mopai',
      });
      return;
    }

    // 从数据库获取实际价格
    const prices = await prisma.price.findMany({
      where: {
        productKey,
        active: true,
      },
      orderBy: [{ tier: 'asc' }, { billingCycle: 'asc' }],
    });

    // 组织价格数据
    const pricingData = Object.entries(subscriptionTiers).reduce((acc, [tier, tierInfo]) => {
      if (tier === 'trial') {
        acc[tier] = {
          ...tierInfo,
          monthlyPrice: 0,
          yearlyPrice: 0,
          features: getTierFeatures(productKey, tier),
        };
      } else {
        const monthlyPrice = prices.find(p => p.tier === tier && p.billingCycle === 'monthly');
        const yearlyPrice = prices.find(p => p.tier === tier && p.billingCycle === 'yearly');

        acc[tier] = {
          ...tierInfo,
          monthlyPrice: monthlyPrice
            ? monthlyPrice.amount / 100
            : (tierInfo as { monthlyPrice?: number }).monthlyPrice ?? 0,
          yearlyPrice: yearlyPrice ? yearlyPrice.amount / 100 : (tierInfo as { yearlyPrice?: number }).yearlyPrice ?? 0,
          features: getTierFeatures(productKey, tier),
        };
      }

      return acc;
    }, {} as Record<string, unknown>);

    res.json({
      success: true,
      data: {
        productKey,
        tiers: pricingData,
        currency: 'USD',
        trialPeriodDays: 30,
      },
    });
  } catch (error: unknown) {
    logger.error('获取套餐定价失败:', error);
    res.status(500).json({
      error: 'server_error',
      message: '获取套餐定价失败',
    });
  }
}
