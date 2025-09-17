import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/jwt.js';
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
        message: '缺少组织ID',
      });
      return;
    }

    // 获取组织信息
    const organization = await organizationService.getOrganization(organizationId);
    if (!organization) {
      res.status(404).json({
        error: 'organization_not_found',
        message: '店铺不存在',
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
      error: error instanceof Error ? error.message : String(error),
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

    if (!organizationId || !productKey || !featureKey) {
      res.status(400).json({
        error: 'missing_parameters',
        message: '缺少必要参数',
      });
      return;
    }

    if (!['ploml', 'mopai'].includes(productKey)) {
      res.status(400).json({
        error: 'invalid_product',
        message: '无效的产品类型',
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
      currentTier = subscription.tier;
      hasAccess = hasFeatureAccess(productKey, subscription.tier, featureKey);
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
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'server_error',
      message: '权限检查失败',
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
        message: '无效的产品类型',
      });
      return;
    }

    // 暂时返回空的定价信息，因为subscriptionService还没有getProductPricing方法
    const pricing: unknown[] = [];

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
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'server_error',
      message: '获取定价信息失败',
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
      message: '此功能需要配合auth-service实现',
      data: {
        organizations: [],
      },
    });
  } catch (error) {
    logger.error('获取用户组织概览失败', {
      userId: (req as AuthenticatedRequest).user.id,
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'server_error',
      message: '获取组织概览失败',
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
        message: '缺少组织ID',
      });
      return;
    }

    if (!productKey || !['ploml', 'mopai'].includes(productKey)) {
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

    logger.info('用户开始试用', {
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
        message: '试用已开始，享受30天免费体验！',
      },
    });
  } catch (error) {
    logger.error('开始试用失败', {
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
      message: '开始试用失败',
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
        message: '缺少组织ID',
      });
      return;
    }

    if (!productKey || !['ploml', 'mopai'].includes(productKey)) {
      res.status(400).json({
        error: 'invalid_product',
        message: '产品类型必须是 ploml 或 mopai',
      });
      return;
    }

    if (!tier || !['basic', 'standard', 'advanced', 'pro'].includes(tier)) {
      res.status(400).json({
        error: 'invalid_tier',
        message: '套餐类型必须是 basic, standard, advanced 或 pro',
      });
      return;
    }

    if (!billingCycle || !['monthly', 'yearly'].includes(billingCycle)) {
      res.status(400).json({
        error: 'invalid_billing_cycle',
        message: '计费周期必须是 monthly 或 yearly',
      });
      return;
    }

    if (!successUrl || !cancelUrl) {
      res.status(400).json({
        error: 'missing_urls',
        message: '缺少支付成功或取消的回调URL',
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

    logger.info('创建支付会话', {
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
        message: '请完成支付以激活订阅',
      },
    });
  } catch (error) {
    logger.error('创建支付会话失败', {
      organizationId: req.params.organizationId,
      userId: (req as AuthenticatedRequest).user.id,
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'server_error',
      message: '创建支付会话失败',
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
        message: '缺少组织ID',
      });
      return;
    }

    if (!productKey || !['ploml', 'mopai'].includes(productKey)) {
      res.status(400).json({
        error: 'invalid_product',
        message: '产品类型必须是 ploml 或 mopai',
      });
      return;
    }

    if (!newTier || !['basic', 'standard', 'advanced', 'pro'].includes(newTier)) {
      res.status(400).json({
        error: 'invalid_tier',
        message: '套餐类型必须是 basic, standard, advanced 或 pro',
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
        message: '未找到当前订阅，请先开始试用或订阅',
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
          message: '请完成支付以升级订阅',
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

    logger.info('用户升级订阅', {
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
        message: '订阅已成功升级！',
      },
    });
  } catch (error) {
    logger.error('升级订阅失败', {
      organizationId: req.params.organizationId,
      userId: (req as AuthenticatedRequest).user.id,
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'server_error',
      message: '升级订阅失败',
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
        message: '缺少组织ID',
      });
      return;
    }

    if (!productKey || !['ploml', 'mopai'].includes(productKey)) {
      res.status(400).json({
        error: 'invalid_product',
        message: '产品类型必须是 ploml 或 mopai',
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
        message: '未找到订阅',
      });
      return;
    }

    const subscription = await subscriptionService.cancelSubscription(
      currentSubscription.id,
      cancelAtPeriodEnd
    );

    logger.info('用户取消订阅', {
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
        ? '订阅将在当前计费周期结束时取消，在此之前您仍可使用所有功能'
        : '订阅已立即取消',
    });
  } catch (error) {
    logger.error('取消订阅失败', {
      organizationId: req.params.organizationId,
      userId: (req as AuthenticatedRequest).user.id,
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'server_error',
      message: '取消订阅失败',
    });
  }
}
