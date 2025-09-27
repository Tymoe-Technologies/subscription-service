import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../types/index.js';
import { organizationService } from '../services/organization.js';
import { subscriptionService } from '../services/subscription.js';
import { hasFeatureAccess, getTierFeatures } from '../config/features.js';
import { logger } from '../utils/logger.js';

// 获取组织的订阅状态（前端缓存用）
export async function getOrganizationSubscriptionStatus(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { organizationId } = req.params;
    const userId = (req as AuthenticatedRequest).user.id;

    if (!organizationId) {
      res.status(400).json({
        error: 'missing_organization_id',
        message: 'Missing organization ID',
      });
      return;
    }

    // 获取组织信息
    const organization = await organizationService.getOrganization(organizationId);
    if (!organization) {
      res.status(404).json({
        error: 'organization_not_found',
        message: 'Store not found',
      });
      return;
    }

    // 获取组织的所有订阅
    const subscriptions = await subscriptionService.getOrganizationSubscriptions(organizationId);

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
        features: getTierFeatures(sub.productKey, sub.tier || 'basic'),
      })),
      lastUpdated: new Date().toISOString(),
    };

    logger.info('Successfully retrieved organization subscription status', {
      userId,
      organizationId,
      subscriptionCount: subscriptions.length,
    });

    res.json({
      success: true,
      data: subscriptionStatus,
    });
  } catch (error) {
    logger.error('Failed to get organization subscription status', {
      organizationId: req.params.organizationId,
      userId: (req as AuthenticatedRequest).user.id,
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'server_error',
      message: 'Failed to get subscription status',
    });
  }
}

// 检查单个功能权限
export async function checkFeatureAccess(req: Request, res: Response): Promise<void> {
  try {
    const { organizationId, productKey, featureKey } = req.params;
    const userId = (req as AuthenticatedRequest).user.id;

    if (!organizationId || !productKey || !featureKey) {
      res.status(400).json({
        error: 'missing_parameters',
        message: 'Missing required parameters',
      });
      return;
    }

    if (!['ploml', 'mopai'].includes(productKey)) {
      res.status(400).json({
        error: 'invalid_product',
        message: 'Invalid product type',
      });
      return;
    }

    // 获取组织的该产品订阅
    const subscription = await subscriptionService.getOrganizationSubscription(
      organizationId,
      productKey
    );

    let hasAccess = false;
    let currentTier = 'none';

    if (subscription && ['trialing', 'active'].includes(subscription.status)) {
      currentTier = subscription.tier || 'basic';
      hasAccess = hasFeatureAccess(productKey, subscription.tier || 'basic', featureKey);
    }

    logger.debug('Feature access check', {
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
    logger.error('Feature access check failed', {
      organizationId: req.params.organizationId,
      productKey: req.params.productKey,
      featureKey: req.params.featureKey,
      userId: (req as AuthenticatedRequest).user.id,
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'server_error',
      message: 'Permission check failed',
    });
  }
}

// 获取产品的定价信息
export function getProductPricing(req: Request, res: Response): void {
  try {
    const { productKey } = req.params;
    const userId = (req as AuthenticatedRequest).user.id;

    if (!productKey || !['ploml', 'mopai'].includes(productKey)) {
      res.status(400).json({
        error: 'invalid_product',
        message: 'Invalid product type',
      });
      return;
    }

    // 暂时返回空的定价信息，因为subscriptionService还没有getProductPricing方法
    const pricing: unknown[] = [];

    logger.debug('Get product pricing', {
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
    logger.error('Failed to get product pricing', {
      productKey: req.params.productKey,
      userId: (req as AuthenticatedRequest).user.id,
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'server_error',
      message: 'Failed to get pricing information',
    });
  }
}

// 获取用户拥有的所有组织的订阅概览
export function getUserOrganizationsOverview(req: Request, res: Response): void {
  try {
    // 这个端点需要调用auth-service获取用户的所有组织
    // 然后获取每个组织的订阅状态
    // 暂时返回提示信息，因为需要auth-service配合

    res.json({
      success: true,
      message: 'This feature needs to be implemented with auth-service',
      data: {
        organizations: [],
      },
    });
  } catch (error) {
    logger.error('Failed to get user organizations overview', {
      userId: (req as AuthenticatedRequest).user.id,
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'server_error',
      message: 'Failed to get organizations overview',
    });
  }
}

// ===== 用户订阅管理功能 =====

// 开始试用
export async function startTrial(req: Request, res: Response): Promise<void> {
  try {
    const { organizationId } = req.params;
    const { productKey } = req.body;
    const userId = (req as AuthenticatedRequest).user.id;

    if (!organizationId) {
      res.status(400).json({
        error: 'missing_organization_id',
        message: 'Missing organization ID',
      });
      return;
    }

    if (!productKey || !['ploml', 'mopai'].includes(productKey)) {
      res.status(400).json({
        error: 'invalid_product',
        message: 'Product type must be ploml or mopai',
      });
      return;
    }

    const subscription = await subscriptionService.createTrialSubscription({
      organizationId,
      productKey,
      userId,
    });

    logger.info('User started trial', {
      userId,
      organizationId,
      productKey,
      subscriptionId: subscription.id,
    });

    res.status(201).json({
      success: true,
      data: {
        subscription,
        trialPeriodDays: 30,
        features: getTierFeatures(productKey, 'trial'),
        message: 'Trial started, enjoy 30 days of free access!',
      },
    });
  } catch (error) {
    logger.error('Failed to start trial', {
      organizationId: req.params.organizationId,
      userId: (req as AuthenticatedRequest).user.id,
      error: error instanceof Error ? error.message : String(error),
    });

    if (error instanceof Error) {
      if (error.message.includes('已经使用过试用期') || error.message.includes('已有')) {
        res.status(409).json({
          error: 'trial_already_used',
          message: error.message,
        });
        return;
      }
    }

    res.status(500).json({
      error: 'server_error',
      message: 'Failed to start trial',
    });
  }
}

// 创建支付会话（订阅付费套餐）
export async function createCheckoutSession(req: Request, res: Response): Promise<void> {
  try {
    const { organizationId } = req.params;
    const { productKey, tier, billingCycle, successUrl, cancelUrl } = req.body;
    const userId = (req as AuthenticatedRequest).user.id;

    if (!organizationId) {
      res.status(400).json({
        error: 'missing_organization_id',
        message: 'Missing organization ID',
      });
      return;
    }

    if (!productKey || !['ploml', 'mopai'].includes(productKey)) {
      res.status(400).json({
        error: 'invalid_product',
        message: 'Product type must be ploml or mopai',
      });
      return;
    }

    if (!tier || !['basic', 'standard', 'advanced', 'pro'].includes(tier)) {
      res.status(400).json({
        error: 'invalid_tier',
        message: 'Tier must be basic, standard, advanced or pro',
      });
      return;
    }

    if (!billingCycle || !['monthly', 'yearly'].includes(billingCycle)) {
      res.status(400).json({
        error: 'invalid_billing_cycle',
        message: 'Billing cycle must be monthly or yearly',
      });
      return;
    }

    if (!successUrl || !cancelUrl) {
      res.status(400).json({
        error: 'missing_urls',
        message: 'Missing payment success or cancel callback URLs',
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

    logger.info('Creating payment session', {
      userId,
      organizationId,
      productKey,
      tier,
      billingCycle,
    });

    res.json({
      success: true,
      data: {
        checkoutUrl: result.checkoutUrl,
        message: 'Please complete payment to activate subscription',
      },
    });
  } catch (error) {
    logger.error('Failed to create payment session', {
      organizationId: req.params.organizationId,
      userId: (req as AuthenticatedRequest).user.id,
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'server_error',
      message: 'Failed to create payment session',
    });
  }
}

// 升级订阅
export async function upgradeUserSubscription(req: Request, res: Response): Promise<void> {
  try {
    const { organizationId } = req.params;
    const { productKey, newTier, billingCycle, successUrl, cancelUrl } = req.body;
    const userId = (req as AuthenticatedRequest).user.id;

    if (!organizationId) {
      res.status(400).json({
        error: 'missing_organization_id',
        message: 'Missing organization ID',
      });
      return;
    }

    if (!productKey || !['ploml', 'mopai'].includes(productKey)) {
      res.status(400).json({
        error: 'invalid_product',
        message: 'Product type must be ploml or mopai',
      });
      return;
    }

    if (!newTier || !['basic', 'standard', 'advanced', 'pro'].includes(newTier)) {
      res.status(400).json({
        error: 'invalid_tier',
        message: 'Tier must be basic, standard, advanced or pro',
      });
      return;
    }

    // 获取当前订阅
    const currentSubscription = await subscriptionService.getOrganizationSubscription(
      organizationId,
      productKey
    );

    if (!currentSubscription) {
      res.status(404).json({
        error: 'subscription_not_found',
        message: 'Current subscription not found, please start trial or subscribe first',
      });
      return;
    }

    // 如果需要支付（从试用升级或升级到更高套餐）
    if (
      currentSubscription.tier === 'trial' ||
      (successUrl && cancelUrl && currentSubscription.tier !== newTier)
    ) {
      const result = await subscriptionService.createPaidSubscription({
        organizationId,
        productKey,
        tier: newTier,
        billingCycle: billingCycle ?? 'monthly',
        successUrl,
        cancelUrl,
      });

      res.json({
        success: true,
        data: {
          requiresPayment: true,
          checkoutUrl: result.checkoutUrl,
          message: 'Please complete payment to upgrade subscription',
        },
      });
      return;
    }

    // 直接升级（不需要额外付费）
    const subscription = await subscriptionService.upgradeSubscription({
      subscriptionId: currentSubscription.id,
      newTier,
      billingCycle,
    });

    logger.info('User upgraded subscription', {
      userId,
      organizationId,
      productKey,
      oldTier: currentSubscription.tier,
      newTier,
    });

    res.json({
      success: true,
      data: {
        requiresPayment: false,
        subscription,
        features: getTierFeatures(productKey, newTier),
        message: 'Subscription upgraded successfully!',
      },
    });
  } catch (error) {
    logger.error('Failed to upgrade subscription', {
      organizationId: req.params.organizationId,
      userId: (req as AuthenticatedRequest).user.id,
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'server_error',
      message: 'Failed to upgrade subscription',
    });
  }
}

// 取消订阅
export async function cancelUserSubscription(req: Request, res: Response): Promise<void> {
  try {
    const { organizationId } = req.params;
    const { productKey, cancelAtPeriodEnd = true } = req.body;
    const userId = (req as AuthenticatedRequest).user.id;

    if (!organizationId) {
      res.status(400).json({
        error: 'missing_organization_id',
        message: 'Missing organization ID',
      });
      return;
    }

    if (!productKey || !['ploml', 'mopai'].includes(productKey)) {
      res.status(400).json({
        error: 'invalid_product',
        message: 'Product type must be ploml or mopai',
      });
      return;
    }

    // 获取当前订阅
    const currentSubscription = await subscriptionService.getOrganizationSubscription(
      organizationId,
      productKey
    );

    if (!currentSubscription) {
      res.status(404).json({
        error: 'subscription_not_found',
        message: 'Subscription not found',
      });
      return;
    }

    const subscription = await subscriptionService.cancelSubscription(
      currentSubscription.id,
      cancelAtPeriodEnd
    );

    logger.info('User canceled subscription', {
      userId,
      organizationId,
      productKey,
      subscriptionId: currentSubscription.id,
      cancelAtPeriodEnd,
    });

    res.json({
      success: true,
      data: { subscription },
      message: cancelAtPeriodEnd
        ? 'Subscription will be canceled at the end of current billing period, you can still use all features until then'
        : 'Subscription canceled immediately',
    });
  } catch (error) {
    logger.error('Failed to cancel subscription', {
      organizationId: req.params.organizationId,
      userId: (req as AuthenticatedRequest).user.id,
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'server_error',
      message: 'Failed to cancel subscription',
    });
  }
}

// 创建新组织（用户选择新增店铺时）
export async function createUserOrganization(req: Request, res: Response): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.id;
    const { name, email } = req.body;

    if (!name || !email) {
      res.status(400).json({
        error: 'missing_required_fields',
        message: 'Name and email are required',
      });
      return;
    }

    // Create organization with auth-service generated ID
    const organizationId = `org_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const organization = await organizationService.createOrganization({
      id: organizationId,
      name,
      email,
    });

    logger.info('User created organization', {
      userId,
      organizationId: organization.id,
      organizationName: name,
    });

    res.status(201).json({
      success: true,
      data: { organization },
      message: 'Organization created successfully',
    });
  } catch (error) {
    logger.error('Failed to create organization', {
      userId: (req as AuthenticatedRequest).user.id,
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'server_error',
      message: 'Failed to create organization',
    });
  }
}

// 获取产品功能列表（用于前端展示不同等级的功能）
export async function getProductFeatures(req: Request, res: Response): Promise<void> {
  try {
    const { productKey } = req.params;

    if (!productKey || !['ploml', 'mopai'].includes(productKey)) {
      res.status(400).json({
        error: 'invalid_product',
        message: 'Product must be ploml or mopai',
      });
      return;
    }

    // Get features for all tiers of the product
    const tierFeatures = {
      trial: getTierFeatures(productKey, 'trial'),
      basic: getTierFeatures(productKey, 'basic'),
      standard: getTierFeatures(productKey, 'standard'),
      advanced: getTierFeatures(productKey, 'advanced'),
      pro: getTierFeatures(productKey, 'pro'),
    };

    res.json({
      success: true,
      data: {
        productKey,
        tiers: tierFeatures,
      },
    });
  } catch (error) {
    logger.error('Failed to get product features', {
      productKey: req.params.productKey,
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'server_error',
      message: 'Failed to get product features',
    });
  }
}
