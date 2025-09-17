import { prisma } from '../infra/prisma.js';
import { stripeService } from '../infra/stripe.js';
import { cacheService } from '../infra/redis.js';
import { organizationService } from './organization.js';
import { service } from '../config/config.js';
import { logger } from '../utils/logger.js';
import type { Subscription, Organization } from '@prisma/client';

export interface CreateTrialSubscriptionParams {
  organizationId: string;
  productKey: 'ploml' | 'mopai';
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
  // 创建试用订阅
  async createTrialSubscription(params: CreateTrialSubscriptionParams): Promise<Subscription> {
    const { organizationId, productKey } = params;

    // 检查组织是否存在
    const organization = await organizationService.getOrganization(organizationId);
    if (!organization) {
      throw new Error(`组织 ${organizationId} 不存在`);
    }

    // 检查是否已使用过试用
    if (organization.hasUsedTrial) {
      throw new Error('该组织已经使用过试用期');
    }

    // 检查是否已有该产品的订阅
    const existingSubscription = await prisma.subscription.findUnique({
      where: {
        organizationId_productKey: {
          organizationId,
          productKey,
        },
      },
    });

    if (existingSubscription) {
      throw new Error(`组织已有 ${productKey} 产品的订阅`);
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
        status: 'trialing',
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
      throw new Error(`组织 ${organizationId} 不存在`);
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
    const price = await prisma.price.findUnique({
      where: {
        productKey_tier_billingCycle: {
          productKey,
          tier,
          billingCycle,
        },
      },
    });

    if (!price) {
      throw new Error(`找不到 ${productKey} ${tier} ${billingCycle} 的价格配置`);
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

    return { checkoutUrl: checkoutSession.url ?? '' };
  }

  // 升级订阅
  async upgradeSubscription(params: UpgradeSubscriptionParams): Promise<Subscription> {
    const { subscriptionId, newTier, billingCycle } = params;

    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });

    if (!subscription) {
      throw new Error(`订阅 ${subscriptionId} 不存在`);
    }

    if (subscription.status !== 'active' && subscription.status !== 'trialing') {
      throw new Error('只能升级活跃或试用中的订阅');
    }

    // 检查是否为升级（不允许降级）
    const tierOrder = ['trial', 'basic', 'standard', 'advanced', 'pro'];
    const currentTierIndex = tierOrder.indexOf(subscription.tier);
    const newTierIndex = tierOrder.indexOf(newTier);

    if (newTierIndex <= currentTierIndex) {
      throw new Error('只允许升级套餐，不允许降级');
    }

    // 获取新价格
    const newPrice = await prisma.price.findUnique({
      where: {
        productKey_tier_billingCycle: {
          productKey: subscription.productKey,
          tier: newTier,
          billingCycle: billingCycle ?? subscription.billingCycle ?? 'monthly',
        },
      },
    });

    if (!newPrice) {
      throw new Error(`找不到新套餐的价格配置`);
    }

    // 如果有Stripe订阅，更新Stripe订阅
    if (subscription.stripeSubscriptionId) {
      await stripeService.updateSubscription(subscription.stripeSubscriptionId, {
        items: [
          {
            id: subscription.stripeSubscriptionId, // 这里需要获取subscription item id
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
        status: subscription.status === 'trialing' ? 'active' : subscription.status,
        trialEnd: subscription.status === 'trialing' ? new Date() : subscription.trialEnd,
      },
    });

    // 清除缓存
    await this.clearSubscriptionCache(subscription.organizationId, subscription.productKey);

    return updatedSubscription;
  }

  // 取消订阅
  async cancelSubscription(
    subscriptionId: string,
    cancelAtPeriodEnd: boolean = true
  ): Promise<Subscription> {
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });

    if (!subscription) {
      throw new Error(`订阅 ${subscriptionId} 不存在`);
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
        status: cancelAtPeriodEnd ? subscription.status : 'canceled',
      },
    });

    // 清除缓存
    await this.clearSubscriptionCache(subscription.organizationId, subscription.productKey);

    return updatedSubscription;
  }

  // 获取订阅详情
  async getSubscription(subscriptionId: string): Promise<SubscriptionWithDetails | null> {
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        organization: true,
        price: true,
      },
    });

    return subscription;
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

    const subscription = await prisma.subscription.findUnique({
      where: {
        organizationId_productKey: {
          organizationId,
          productKey,
        },
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
      where: { organizationId },
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
        logger.info(`未处理的webhook事件类型: ${event.type}`);
    }
  }

  // 处理结账会话完成
  private async handleCheckoutSessionCompleted(session: Record<string, unknown>): Promise<void> {
    const metadata = session.metadata as Record<string, unknown> | undefined;
    if (!metadata) {
      logger.error('Checkout session metadata 不存在:', session);
      return;
    }
    const { organizationId, productKey, tier, billingCycle } = metadata;

    if (!organizationId || !productKey || !tier || !billingCycle) {
      logger.error('Checkout session metadata 不完整:', session.metadata);
      return;
    }

    // 获取Stripe订阅
    const subscriptionId = session.subscription as string | undefined;
    if (!subscriptionId) {
      logger.error('缺少subscription ID:', session);
      return;
    }
    const stripeSubscription = await stripeService.getSubscription(subscriptionId);
    if (!stripeSubscription) {
      logger.error('无法获取Stripe订阅:', session.subscription);
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
          tier,
          billingCycle,
          status: stripeSubscription.status,
          stripeSubscriptionId: stripeSubscription.id,
          stripePriceId: stripeSubscription.items.data[0]?.price.id ?? null,
          currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
          currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
          trialEnd: stripeSubscription.trial_end
            ? new Date(stripeSubscription.trial_end * 1000)
            : null,
        },
      });
    } else {
      // 创建新订阅
      await prisma.subscription.create({
        data: {
          organizationId: organizationId as string,
          productKey: productKey as string,
          tier: tier as string,
          billingCycle: billingCycle as string,
          status: stripeSubscription.status,
          stripeSubscriptionId: stripeSubscription.id,
          stripePriceId: stripeSubscription.items.data[0]?.price.id ?? null,
          currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
          currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
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
          data: { status: 'active' },
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
          data: { status: 'past_due' },
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
      logger.error('缺少subscription ID:', stripeSubscription);
      return;
    }
    const subscription = await prisma.subscription.findFirst({
      where: { stripeSubscriptionId: subscriptionId },
    });

    if (subscription) {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: stripeSubscription.status as string,
          currentPeriodStart: new Date((stripeSubscription.current_period_start as number) * 1000),
          currentPeriodEnd: new Date((stripeSubscription.current_period_end as number) * 1000),
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
      logger.error('缺少subscription ID:', stripeSubscription);
      return;
    }
    const subscription = await prisma.subscription.findFirst({
      where: { stripeSubscriptionId: subscriptionId },
    });

    if (subscription) {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: 'canceled' },
      });

      // 清除缓存
      await this.clearSubscriptionCache(subscription.organizationId, subscription.productKey);
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
    if (subscription.status === 'active' || subscription.status === 'trialing') {
      // 检查是否过期
      if (subscription.currentPeriodEnd && subscription.currentPeriodEnd < new Date()) {
        return false;
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

    const summary = subscriptions.map(sub => {
      const isActive = this.isSubscriptionActive(organizationId, sub.productKey);
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
        tier: sub.tier,
        status: sub.status,
        isActive: Boolean(isActive),
      };

      if (daysUntilExpiry !== undefined) {
        result.daysUntilExpiry = daysUntilExpiry;
      }

      return result;
    });

    return {
      hasActiveSubscriptions: summary.some(s => s.isActive),
      subscriptions: summary,
    };
  }
}

export const subscriptionService = new SubscriptionService();
