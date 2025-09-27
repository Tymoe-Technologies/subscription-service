import { prisma } from '../infra/prisma.js';
import { stripeService } from '../infra/stripe.js';
import { cacheService } from '../infra/redis.js';
import { organizationService } from './organization.js';
import { authServiceClient } from './authService.js';
import { service } from '../config/config.js';
import { logger } from '../utils/logger.js';
import { SUBSCRIPTION_STATUS } from '../constants';
import type { Subscription, Organization } from '@prisma/client';

export interface CreateTrialSubscriptionParams {
  organizationId: string;
  productKey: 'ploml' | 'mopai';
  userId: string; // 添加userId参数用于检查用户trial使用情况
}

export interface CreatePaidSubscriptionParams {
  organizationId: string;
  productKey: 'ploml' | 'mopai';
  tier: 'basic' | 'standard' | 'advanced' | 'pro';
  billingCycle: 'monthly' | 'yearly';
  successUrl: string;
  cancelUrl: string;
}

export interface UpgradeSubscriptionParams {
  subscriptionId: string;
  newTier: 'basic' | 'standard' | 'advanced' | 'pro';
  billingCycle?: 'monthly' | 'yearly';
}

export interface SubscriptionWithDetails extends Subscription {
  organization: Organization;
  price?: {
    id: string;
    stripePriceId: string;
    tier: string;
    billingCycle: string;
    amount: number;
    currency: string;
  } | null;
}

export class SubscriptionService {
  // 检查用户是否有权限访问组织
  async checkUserOrganizationAccess(userId: string, organizationId: string): Promise<boolean> {
    try {
      // 使用auth-service检查用户组织访问权限
      return await authServiceClient.checkUserOrganizationAccess(userId, organizationId);
    } catch (error) {
      logger.error('Failed to check user organization access permission', {
        userId,
        organizationId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // 获取组织的活跃订阅（优先选择最高级别的订阅）
  async getActiveSubscription(organizationId: string, productKey?: string): Promise<Subscription | null> {
    try {
      const where: any = {
        organizationId,
        status: { in: [SUBSCRIPTION_STATUS.ACTIVE, SUBSCRIPTION_STATUS.TRIALING] },
      };

      if (productKey) {
        where.productKey = productKey;
      }

      // 添加软删除过滤
      where.deletedAt = null;

      const subscriptions = await prisma.subscription.findMany({
        where,
        orderBy: [
          // 按订阅等级排序，pro > advanced > standard > basic > trial
          { tier: 'desc' },
          { createdAt: 'desc' },
        ],
      });

      // 检查订阅是否真的活跃（包含宽限期逻辑）
      for (const subscription of subscriptions) {
        if (await this.isSubscriptionActive(organizationId, subscription.productKey)) {
          return subscription;
        }
      }

      return null;
    } catch (error) {
      logger.error('Failed to get active subscription', {
        organizationId,
        productKey,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  // 创建试用订阅
  async createTrialSubscription(params: CreateTrialSubscriptionParams): Promise<Subscription> {
    const { organizationId, productKey, userId } = params;

    // 检查组织是否存在
    const organization = await organizationService.getOrganization(organizationId);
    if (!organization) {
      throw new Error(`Organization ${organizationId} not found`);
    }

    // 检查用户是否已在任何组织中使用过试用
    // 通过auth-service获取用户的所有组织，然后检查这些组织是否已使用过trial
    const userOrganizations = await authServiceClient.getUserOrganizations(userId);

    // 检查用户的任何组织是否已经使用过trial
    const hasUsedTrialInAnyOrg = await this.checkUserTrialUsage(userOrganizations);
    if (hasUsedTrialInAnyOrg) {
      throw new Error('User has already used trial period in another organization');
    }

    // 检查是否已有该产品的订阅（排除已删除的）
    const existingSubscription = await prisma.subscription.findFirst({
      where: {
        organizationId,
        productKey,
        deletedAt: null,
      },
    });

    if (existingSubscription) {
      throw new Error(`Organization already has ${productKey} product subscription`);
    }

    // 计算试用结束时间
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + service.business.trialPeriodDays);

    // 创建试用订阅
    const subscription = await prisma.subscription.create({
      data: {
        organizationId,
        productKey,
        tier: 'trial',
        status: SUBSCRIPTION_STATUS.TRIALING,
        trialEnd,
        currentPeriodStart: new Date(),
        currentPeriodEnd: trialEnd,
      },
    });

    // 标记组织已使用试用
    await organizationService.markTrialUsed(organizationId);

    // 清除缓存
    await this.clearSubscriptionCache(organizationId, productKey);

    return subscription;
  }

  // 创建付费订阅（通过Stripe Checkout）
  async createPaidSubscription(
    params: CreatePaidSubscriptionParams
  ): Promise<{ checkoutUrl: string }> {
    const { organizationId, productKey, tier, billingCycle, successUrl, cancelUrl } = params;

    // 检查组织是否存在
    const organization = await organizationService.getOrganization(organizationId);
    if (!organization) {
      throw new Error(`Organization ${organizationId} does not exist`);
    }

    // 获取或创建Stripe客户
    let stripeCustomerId = organization.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripeService.createCustomer({
        email: `org-${organizationId}@example.com`, // 实际应用中应该从auth-service获取
        name: organization.name,
        organizationId,
      });
      stripeCustomerId = customer.id;
      await organizationService.setStripeCustomerId(organizationId, stripeCustomerId);
    }

    // 获取价格ID
    const price = await prisma.price.findFirst({
      where: {
        productKey,
        tier,
        billingCycle,
        active: true,
      },
    });

    if (!price) {
      throw new Error(`Cannot find price configuration for ${productKey} ${tier} ${billingCycle}`);
    }

    if (!price.stripePriceId) {
      throw new Error(`Price configuration missing Stripe price ID for ${productKey} ${tier} ${billingCycle}`);
    }

    // 创建Stripe Checkout会话
    const checkoutSession = await stripeService.createCheckoutSession({
      customerId: stripeCustomerId,
      priceId: price.stripePriceId,
      successUrl,
      cancelUrl,
      metadata: {
        organizationId,
        productKey,
        tier,
        billingCycle,
      },
    });

    if (!checkoutSession.url) {
      throw new Error('Failed to create Stripe checkout session - no URL returned');
    }
    return { checkoutUrl: checkoutSession.url };
  }

  // 升级订阅
  async upgradeSubscription(params: UpgradeSubscriptionParams): Promise<Subscription> {
    const { subscriptionId, newTier, billingCycle } = params;

    const subscription = await prisma.subscription.findFirst({
      where: {
        id: subscriptionId,
        deletedAt: null,
      },
    });

    if (!subscription) {
      throw new Error(`Subscription ${subscriptionId} does not exist or has been deleted`);
    }

    if (subscription.status !== SUBSCRIPTION_STATUS.ACTIVE && subscription.status !== SUBSCRIPTION_STATUS.TRIALING) {
      throw new Error('Can only upgrade active or trial subscriptions');
    }

    // 检查是否为升级（不允许降级）
    const tierOrder = ['trial', 'basic', 'standard', 'advanced', 'pro'];
    const currentTierIndex = tierOrder.indexOf(subscription.tier || 'trial');
    const newTierIndex = tierOrder.indexOf(newTier);

    if (newTierIndex <= currentTierIndex) {
      throw new Error('Only upgrades are allowed, downgrades are not permitted');
    }

    // 获取新价格
    const newPrice = await prisma.price.findFirst({
      where: {
        productKey: subscription.productKey,
        tier: newTier,
        billingCycle: billingCycle ?? subscription.billingCycle ?? 'monthly',
        active: true,
      },
    });

    if (!newPrice) {
      throw new Error(`Cannot find price configuration for new plan`);
    }

    // 如果有Stripe订阅，更新Stripe订阅
    if (subscription.stripeSubscriptionId) {
      // 获取Stripe订阅信息以获取subscription item ID
      const stripeSubscription = await stripeService.getSubscription(subscription.stripeSubscriptionId);

      if (!stripeSubscription) {
        throw new Error('Could not retrieve Stripe subscription for upgrade');
      }

      const subscriptionItemId = stripeSubscription.items.data[0]?.id;

      if (!subscriptionItemId) {
        throw new Error('Could not find subscription item ID for upgrade');
      }

      if (!newPrice.stripePriceId) {
        throw new Error('New price configuration missing Stripe price ID');
      }

      await stripeService.updateSubscription(subscription.stripeSubscriptionId, {
        items: [
          {
            id: subscriptionItemId,
            price: newPrice.stripePriceId,
          },
        ],
        proration_behavior: 'create_prorations', // 按比例计费
      });
    }

    // 更新本地订阅记录
    const updatedSubscription = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        tier: newTier,
        billingCycle: billingCycle ?? subscription.billingCycle,
        stripePriceId: newPrice.stripePriceId,
        status: subscription.status === SUBSCRIPTION_STATUS.TRIALING ? SUBSCRIPTION_STATUS.ACTIVE : subscription.status,
        trialEnd: subscription.status === SUBSCRIPTION_STATUS.TRIALING ? new Date() : subscription.trialEnd,
      },
    });

    // 清除缓存
    await this.clearSubscriptionCache(subscription.organizationId, subscription.productKey);

    return updatedSubscription;
  }

  // 软删除订阅
  async deleteSubscription(subscriptionId: string): Promise<void> {
    const subscription = await prisma.subscription.findFirst({
      where: {
        id: subscriptionId,
        deletedAt: null,
      },
    });

    if (!subscription) {
      throw new Error(`Subscription ${subscriptionId} does not exist or has been deleted`);
    }

    // 如果有Stripe订阅，取消Stripe订阅
    if (subscription.stripeSubscriptionId) {
      try {
        await stripeService.cancelSubscription(subscription.stripeSubscriptionId, false);
      } catch (error) {
        logger.error(`Failed to cancel Stripe subscription ${subscription.stripeSubscriptionId}:`, error);
      }
    }

    // 软删除订阅
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        status: SUBSCRIPTION_STATUS.CANCELED,
        deletedAt: new Date(),
      },
    });

    logger.info(`Subscription ${subscriptionId} has been soft deleted`, {
      subscriptionId,
      organizationId: subscription.organizationId,
      productKey: subscription.productKey,
    });

    // 清除缓存
    await this.clearSubscriptionCache(subscription.organizationId, subscription.productKey);
  }

  // 取消订阅（不删除）
  async cancelSubscription(
    subscriptionId: string,
    cancelAtPeriodEnd: boolean = true
  ): Promise<Subscription> {
    const subscription = await prisma.subscription.findFirst({
      where: {
        id: subscriptionId,
        deletedAt: null,
      },
    });

    if (!subscription) {
      throw new Error(`Subscription ${subscriptionId} does not exist or has been deleted`);
    }

    // 如果有Stripe订阅，取消Stripe订阅
    if (subscription.stripeSubscriptionId) {
      await stripeService.cancelSubscription(subscription.stripeSubscriptionId, cancelAtPeriodEnd);
    }

    // 更新本地订阅状态
    const updatedSubscription = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        cancelAtPeriodEnd: cancelAtPeriodEnd,
        status: cancelAtPeriodEnd ? subscription.status : SUBSCRIPTION_STATUS.CANCELED,
      },
    });

    // 清除缓存
    await this.clearSubscriptionCache(subscription.organizationId, subscription.productKey);

    return updatedSubscription;
  }

  // 获取订阅详情（排除已删除的）
  async getSubscription(subscriptionId: string): Promise<SubscriptionWithDetails | null> {
    const subscription = await prisma.subscription.findFirst({
      where: {
        id: subscriptionId,
        deletedAt: null,
      },
      include: {
        organization: true,
      },
    });

    if (!subscription) {
      return null;
    }

    // 获取price信息
    const priceRecord = subscription.stripePriceId
      ? await prisma.price.findFirst({
          where: { stripePriceId: subscription.stripePriceId }
        })
      : null;

    // 将price记录转换为interface期望的格式
    const price = priceRecord && priceRecord.stripePriceId && priceRecord.tier && priceRecord.billingCycle &&
                 priceRecord.amount !== null && priceRecord.currency
      ? {
          id: priceRecord.id,
          stripePriceId: priceRecord.stripePriceId,
          tier: priceRecord.tier,
          billingCycle: priceRecord.billingCycle,
          amount: priceRecord.amount,
          currency: priceRecord.currency,
        }
      : null;

    return {
      ...subscription,
      price
    };
  }

  // 获取组织的订阅
  async getOrganizationSubscription(
    organizationId: string,
    productKey: string
  ): Promise<Subscription | null> {
    const cacheKey = `sub:${organizationId}:${productKey}`;
    const cached = await cacheService.get<Subscription>(cacheKey);
    if (cached) {
      return cached;
    }

    const subscription = await prisma.subscription.findFirst({
      where: {
        organizationId,
        productKey,
        deletedAt: null,
      },
    });

    if (subscription) {
      // 缓存5分钟
      await cacheService.set(cacheKey, subscription, 300);
    }

    return subscription;
  }

  // 获取组织的所有订阅
  async getOrganizationSubscriptions(organizationId: string): Promise<Subscription[]> {
    const cacheKey = `subs:${organizationId}`;
    const cached = await cacheService.get<Subscription[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const subscriptions = await prisma.subscription.findMany({
      where: {
        organizationId,
        deletedAt: null,
      },
    });

    // 缓存5分钟
    await cacheService.set(cacheKey, subscriptions, 300);

    return subscriptions;
  }

  // 处理Stripe webhook事件
  async handleStripeWebhook(event: Record<string, unknown>): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed':
        if (event.data && typeof event.data === 'object' && 'object' in event.data) {
          await this.handleCheckoutSessionCompleted(event.data.object as Record<string, unknown>);
        }
        break;

      case 'invoice.payment_succeeded':
        if (event.data && typeof event.data === 'object' && 'object' in event.data) {
          await this.handleInvoicePaymentSucceeded(event.data.object as Record<string, unknown>);
        }
        break;

      case 'invoice.payment_failed':
        if (event.data && typeof event.data === 'object' && 'object' in event.data) {
          await this.handleInvoicePaymentFailed(event.data.object as Record<string, unknown>);
        }
        break;

      case 'customer.subscription.updated':
        if (event.data && typeof event.data === 'object' && 'object' in event.data) {
          await this.handleSubscriptionUpdated(event.data.object as Record<string, unknown>);
        }
        break;

      case 'customer.subscription.deleted':
        if (event.data && typeof event.data === 'object' && 'object' in event.data) {
          await this.handleSubscriptionDeleted(event.data.object as Record<string, unknown>);
        }
        break;

      default:
        logger.info(`Unhandled webhook event type: ${event.type}`);
    }
  }

  // 处理结账会话完成
  private async handleCheckoutSessionCompleted(session: Record<string, unknown>): Promise<void> {
    const metadata = session.metadata as Record<string, unknown> | undefined;
    if (!metadata) {
      logger.error('Checkout session metadata does not exist:', session);
      return;
    }
    const { organizationId, productKey, tier, billingCycle } = metadata;

    if (!organizationId || !productKey || !tier || !billingCycle) {
      logger.error('Checkout session metadata is incomplete:', session.metadata);
      return;
    }

    // 获取Stripe订阅
    const subscriptionId = session.subscription as string | undefined;
    if (!subscriptionId) {
      logger.error('Missing subscription ID:', session);
      return;
    }
    const stripeSubscription = await stripeService.getSubscription(subscriptionId);
    if (!stripeSubscription) {
      logger.error('Unable to get Stripe subscription:', session.subscription);
      return;
    }

    // 检查是否已有订阅记录
    const subscription = await this.getOrganizationSubscription(
      organizationId as string,
      productKey as string
    );

    if (subscription) {
      // 更新现有订阅
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          tier: typeof tier === 'string' ? tier : 'basic',
          billingCycle: typeof billingCycle === 'string' ? billingCycle : 'monthly',
          status: this.mapStripeStatusToLocal(stripeSubscription.status),
          stripeSubscriptionId: stripeSubscription.id,
          stripePriceId: stripeSubscription.items.data[0]?.price.id ?? null,
          currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
          currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
          endDate: new Date(stripeSubscription.current_period_end * 1000),
          gracePeriodEnd: stripeSubscription.cancel_at_period_end
            ? new Date(stripeSubscription.current_period_end * 1000)
            : new Date(stripeSubscription.current_period_end * 1000 + (7 * 24 * 60 * 60 * 1000)), // 7天宽限期
          trialEnd: stripeSubscription.trial_end
            ? new Date(stripeSubscription.trial_end * 1000)
            : null,
        },
      });
    } else {
      // 创建新订阅
      await prisma.subscription.create({
        data: {
          organizationId: typeof organizationId === 'string' ? organizationId : '',
          productKey: typeof productKey === 'string' ? productKey : '',
          tier: typeof tier === 'string' ? tier : 'basic',
          billingCycle: typeof billingCycle === 'string' ? billingCycle : 'monthly',
          status: this.mapStripeStatusToLocal(stripeSubscription.status),
          stripeSubscriptionId: stripeSubscription.id,
          stripePriceId: stripeSubscription.items.data[0]?.price.id ?? null,
          currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
          currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
          endDate: new Date(stripeSubscription.current_period_end * 1000),
          gracePeriodEnd: stripeSubscription.cancel_at_period_end
            ? new Date(stripeSubscription.current_period_end * 1000)
            : new Date(stripeSubscription.current_period_end * 1000 + (7 * 24 * 60 * 60 * 1000)), // 7天宽限期
          trialEnd: stripeSubscription.trial_end
            ? new Date(stripeSubscription.trial_end * 1000)
            : null,
        },
      });
    }

    // 清除缓存
    await this.clearSubscriptionCache(organizationId as string, productKey as string);
  }

  // 处理发票支付成功
  private async handleInvoicePaymentSucceeded(invoice: Record<string, unknown>): Promise<void> {
    const subscriptionId = invoice.subscription as string | undefined;
    if (subscriptionId) {
      const subscription = await prisma.subscription.findFirst({
        where: { stripeSubscriptionId: subscriptionId },
      });

      if (subscription) {
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: SUBSCRIPTION_STATUS.ACTIVE },
        });

        // 清除缓存
        await this.clearSubscriptionCache(subscription.organizationId, subscription.productKey);
      }
    }
  }

  // 处理发票支付失败
  private async handleInvoicePaymentFailed(invoice: Record<string, unknown>): Promise<void> {
    const subscriptionId = invoice.subscription as string | undefined;
    if (subscriptionId) {
      const subscription = await prisma.subscription.findFirst({
        where: { stripeSubscriptionId: subscriptionId },
      });

      if (subscription) {
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: SUBSCRIPTION_STATUS.PAST_DUE },
        });

        // 清除缓存
        await this.clearSubscriptionCache(subscription.organizationId, subscription.productKey);
      }
    }
  }

  // 处理订阅更新
  private async handleSubscriptionUpdated(stripeSubscription: Record<string, unknown>): Promise<void> {
    const subscriptionId = stripeSubscription.id as string | undefined;
    if (!subscriptionId) {
      logger.error('Missing subscription ID:', stripeSubscription);
      return;
    }
    const subscription = await prisma.subscription.findFirst({
      where: { stripeSubscriptionId: subscriptionId },
    });

    if (subscription) {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: this.mapStripeStatusToLocal(stripeSubscription.status as string),
          currentPeriodStart: new Date((stripeSubscription.current_period_start as number) * 1000),
          currentPeriodEnd: new Date((stripeSubscription.current_period_end as number) * 1000),
          endDate: new Date((stripeSubscription.current_period_end as number) * 1000),
          gracePeriodEnd: (stripeSubscription.cancel_at_period_end as boolean)
            ? new Date((stripeSubscription.current_period_end as number) * 1000)
            : new Date((stripeSubscription.current_period_end as number) * 1000 + (7 * 24 * 60 * 60 * 1000)), // 7天宽限期
          cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end as boolean,
        },
      });

      // 清除缓存
      await this.clearSubscriptionCache(subscription.organizationId, subscription.productKey);
    }
  }

  // 处理订阅删除
  private async handleSubscriptionDeleted(stripeSubscription: Record<string, unknown>): Promise<void> {
    const subscriptionId = stripeSubscription.id as string | undefined;
    if (!subscriptionId) {
      logger.error('Missing subscription ID:', stripeSubscription);
      return;
    }
    const subscription = await prisma.subscription.findFirst({
      where: { stripeSubscriptionId: subscriptionId },
    });

    if (subscription) {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: SUBSCRIPTION_STATUS.CANCELED },
      });

      // 清除缓存
      await this.clearSubscriptionCache(subscription.organizationId, subscription.productKey);
    }
  }

  // 标记订阅为过期状态
  private async markSubscriptionExpired(subscriptionId: string): Promise<void> {
    try {
      const subscription = await prisma.subscription.findUnique({
        where: { id: subscriptionId }
      });

      if (!subscription) {
        logger.warn('Attempted to mark non-existent subscription as expired', { subscriptionId });
        return;
      }

      // 只有在状态不是 EXPIRED 时才更新
      if (subscription.status !== SUBSCRIPTION_STATUS.EXPIRED) {
        await prisma.subscription.update({
          where: {
            id: subscriptionId,
            version: subscription.version
          },
          data: {
            status: SUBSCRIPTION_STATUS.EXPIRED,
            version: subscription.version + 1,
            lastSyncedAt: new Date()
          }
        });

        // 清除缓存
        await this.clearSubscriptionCache(subscription.organizationId, subscription.productKey);

        logger.info('Subscription marked as expired', {
          subscriptionId,
          organizationId: subscription.organizationId,
          productKey: subscription.productKey
        });
      }
    } catch (error) {
      logger.error('Failed to mark subscription as expired', {
        subscriptionId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // 清除订阅相关缓存
  private async clearSubscriptionCache(organizationId: string, productKey: string): Promise<void> {
    await Promise.all([
      cacheService.delete(`sub:${organizationId}:${productKey}`),
      cacheService.delete(`subs:${organizationId}`),
      cacheService.delete(`org_subs:${organizationId}`),
    ]);
  }

  // 检查订阅状态
  async isSubscriptionActive(organizationId: string, productKey: string): Promise<boolean> {
    const subscription = await this.getOrganizationSubscription(organizationId, productKey);

    if (!subscription) {
      return false;
    }

    // 检查订阅是否活跃或在试用期
    if (subscription.status === SUBSCRIPTION_STATUS.ACTIVE || subscription.status === SUBSCRIPTION_STATUS.TRIALING) {
      const now = new Date();

      // 检查是否过期 - 先检查主要周期结束时间
      if (subscription.currentPeriodEnd && subscription.currentPeriodEnd < now) {
        // 如果有宽限期，检查是否在宽限期内
        if (subscription.gracePeriodEnd && subscription.gracePeriodEnd >= now) {
          return true; // 在宽限期内，订阅仍然有效
        }

        // 检查是否需要将状态更新为过期
        if (subscription.gracePeriodEnd && subscription.gracePeriodEnd < now) {
          await this.markSubscriptionExpired(subscription.id);
          return false;
        }

        return false; // 没有宽限期且已过期
      }

      return true;
    }

    return false;
  }

  // 获取订阅摘要
  async getSubscriptionSummary(organizationId: string): Promise<{
    hasActiveSubscriptions: boolean;
    subscriptions: Array<{
      productKey: string;
      tier: string;
      status: string;
      isActive: boolean;
      daysUntilExpiry?: number;
    }>;
  }> {
    const subscriptions = await this.getOrganizationSubscriptions(organizationId);

    const summary = await Promise.all(subscriptions.map(async sub => {
      const isActive = await this.isSubscriptionActive(organizationId, sub.productKey);
      let daysUntilExpiry: number | undefined;

      if (sub.currentPeriodEnd) {
        const now = new Date();
        const diffTime = sub.currentPeriodEnd.getTime() - now.getTime();
        daysUntilExpiry = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      }

      const result: {
        productKey: string;
        tier: string;
        status: string;
        isActive: boolean;
        daysUntilExpiry?: number;
      } = {
        productKey: sub.productKey,
        tier: sub.tier || 'basic',
        status: sub.status,
        isActive: Boolean(isActive),
      };

      if (daysUntilExpiry !== undefined) {
        result.daysUntilExpiry = daysUntilExpiry;
      }

      return result;
    }));

    return {
      hasActiveSubscriptions: summary.some(s => s.isActive),
      subscriptions: summary,
    };
  }

  // 从Stripe同步订阅数据到本地数据库
  async syncSubscriptionFromStripe(
    stripeSubscription: any,
    organizationId: string,
    productKey: string
  ): Promise<Subscription> {
    try {
      const tier = await this.mapStripeTierToLocal(stripeSubscription.items.data[0]?.price?.id);

      const subscriptionData = {
        organizationId,
        productKey,
        tier,
        status: this.mapStripeStatusToLocal(stripeSubscription.status),
        billingCycle: stripeSubscription.items.data[0]?.price?.recurring?.interval === 'year' ? 'yearly' : 'monthly',
        currentPeriodStart: stripeSubscription.current_period_start
          ? new Date(stripeSubscription.current_period_start * 1000)
          : null,
        currentPeriodEnd: stripeSubscription.current_period_end
          ? new Date(stripeSubscription.current_period_end * 1000)
          : null,
        endDate: stripeSubscription.current_period_end
          ? new Date(stripeSubscription.current_period_end * 1000)
          : null,
        gracePeriodEnd: stripeSubscription.current_period_end
          ? (stripeSubscription.cancel_at_period_end
            ? new Date(stripeSubscription.current_period_end * 1000)
            : new Date(stripeSubscription.current_period_end * 1000 + (7 * 24 * 60 * 60 * 1000))) // 7天宽限期
          : null,
        trialEnd: stripeSubscription.trial_end
          ? new Date(stripeSubscription.trial_end * 1000)
          : null,
        stripeSubscriptionId: stripeSubscription.id,
        stripePriceId: stripeSubscription.items.data[0]?.price?.id || null,
        cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end || false,
        lastWebhookEventId: stripeSubscription.latest_invoice || stripeSubscription.id,
        lastSyncedAt: new Date()
      };

      // 尝试更新现有订阅或创建新订阅
      const subscription = await prisma.subscription.upsert({
        where: {
          organizationId_productKey: {
            organizationId,
            productKey
          }
        },
        create: {
          ...subscriptionData,
          version: 1
        },
        update: {
          ...subscriptionData,
          version: { increment: 1 }
        },
        include: {
          organization: true
        }
      });

      logger.info('Subscription synced from Stripe', {
        subscriptionId: subscription.id,
        stripeSubscriptionId: stripeSubscription.id,
        organizationId,
        productKey,
        status: subscription.status
      });

      return subscription;
    } catch (error) {
      logger.error('Failed to sync subscription from Stripe', {
        stripeSubscriptionId: stripeSubscription.id,
        organizationId,
        productKey,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  // 将Stripe价格ID映射到本地层级
  private async mapStripeTierToLocal(stripePriceId?: string): Promise<string> {
    if (!stripePriceId) return 'basic';

    try {
      // 查询数据库中的价格表来获取对应的层级
      const price = await prisma.price.findFirst({
        where: { stripePriceId }
      });

      return price?.tier || 'basic';
    } catch (error) {
      logger.error('Failed to map Stripe price ID to tier', {
        stripePriceId,
        error: error instanceof Error ? error.message : String(error)
      });
      return 'basic';
    }
  }

  // 将Stripe状态映射到本地状态
  private mapStripeStatusToLocal(stripeStatus: string): 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED' {
    switch (stripeStatus.toLowerCase()) {
      case 'trialing':
        return 'TRIALING';
      case 'active':
        return 'ACTIVE';
      case 'past_due':
        return 'PAST_DUE';
      case 'canceled':
      case 'cancelled':
        return 'CANCELED';
      case 'expired':
      case 'incomplete_expired':
        return 'EXPIRED';
      default:
        logger.warn('Unknown Stripe status, defaulting to CANCELED', { stripeStatus });
        return 'CANCELED';
    }
  }

  // 获取组织的功能权限配置
  async getOrganizationFeatures(organizationId: string): Promise<{
    level: string;
    features: Record<string, {
      isEnabled: boolean;
      limit: number | null;
      unit?: string;
    }>;
  } | null> {
    try {
      // 获取组织的活跃订阅
      const activeSubscription = await this.getActiveSubscription(organizationId);

      if (!activeSubscription) {
        logger.warn('No active subscription found for organization', { organizationId });
        return null;
      }

      // 通过Product获取levelKey
      const product = await prisma.product.findUnique({
        where: { key: activeSubscription.productKey },
        include: { level: true }
      });

      if (!product || !product.level) {
        logger.warn('Product or level not found for subscription', {
          organizationId,
          productKey: activeSubscription.productKey
        });
        return null;
      }

      const levelKey = product.level.key;

      // 获取该level下的所有entitlements
      const entitlements = await prisma.entitlement.findMany({
        where: { levelKey },
        include: {
          feature: true
        }
      });

      // 构建features对象
      const features: Record<string, {
        isEnabled: boolean;
        limit: number | null;
        unit?: string;
      }> = {};

      for (const entitlement of entitlements) {
        features[entitlement.feature.key] = {
          isEnabled: entitlement.isEnabled,
          limit: entitlement.limit,
          ...(entitlement.feature.unit && { unit: entitlement.feature.unit })
        };
      }

      logger.info('Organization features retrieved', {
        organizationId,
        levelKey,
        featuresCount: Object.keys(features).length
      });

      return {
        level: levelKey,
        features
      };

    } catch (error) {
      logger.error('Failed to get organization features', {
        organizationId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  // 检查组织是否有特定功能权限
  async hasFeatureAccess(
    organizationId: string,
    featureKey: string
  ): Promise<boolean> {
    try {
      const orgFeatures = await this.getOrganizationFeatures(organizationId);

      if (!orgFeatures) {
        return false;
      }

      const feature = orgFeatures.features[featureKey];
      return feature ? feature.isEnabled : false;
    } catch (error) {
      logger.error('Failed to check feature access', {
        organizationId,
        featureKey,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  // 检查组织功能使用限制
  async checkFeatureLimit(
    organizationId: string,
    featureKey: string,
    currentUsage: number
  ): Promise<{
    hasAccess: boolean;
    limit: number | null;
    isWithinLimit: boolean;
    usage: number;
  }> {
    try {
      const orgFeatures = await this.getOrganizationFeatures(organizationId);

      if (!orgFeatures) {
        return {
          hasAccess: false,
          limit: null,
          isWithinLimit: false,
          usage: currentUsage
        };
      }

      const feature = orgFeatures.features[featureKey];

      if (!feature || !feature.isEnabled) {
        return {
          hasAccess: false,
          limit: feature?.limit || null,
          isWithinLimit: false,
          usage: currentUsage
        };
      }

      // null表示无限制
      if (feature.limit === null) {
        return {
          hasAccess: true,
          limit: null,
          isWithinLimit: true,
          usage: currentUsage
        };
      }

      // 检查是否在限制范围内
      const isWithinLimit = currentUsage <= feature.limit;

      return {
        hasAccess: true,
        limit: feature.limit,
        isWithinLimit,
        usage: currentUsage
      };

    } catch (error) {
      logger.error('Failed to check feature limit', {
        organizationId,
        featureKey,
        currentUsage,
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        hasAccess: false,
        limit: null,
        isWithinLimit: false,
        usage: currentUsage
      };
    }
  }

  // 检查用户是否在任何组织中使用过试用
  private async checkUserTrialUsage(userOrganizations: string[]): Promise<boolean> {
    try {
      // 检查用户的任何组织是否有trial订阅历史
      const trialUsageCount = await prisma.subscription.count({
        where: {
          organizationId: { in: userOrganizations },
          tier: 'trial',
          deletedAt: null,
        },
      });

      return trialUsageCount > 0;
    } catch (error) {
      logger.error('Error checking user trial usage', {
        userOrganizations,
        error: error instanceof Error ? error.message : String(error),
      });
      // 如果检查失败，为安全起见，返回true（不允许使用trial）
      return true;
    }
  }
}

export const subscriptionService = new SubscriptionService();
