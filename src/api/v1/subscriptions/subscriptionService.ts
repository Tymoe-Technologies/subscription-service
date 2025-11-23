import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import { prisma } from '../../../infra/prisma.js';
import { stripe } from '../../../infra/stripe.js';
import { AppError } from '../../../utils/errors.js';
import { logger } from '../../../utils/logger.js';
import { env } from '../../../config/env.js';
import {
  CreateCheckoutParams,
  CheckoutSessionResult,
  StripeLineItem,
  SubscriptionDetails,
  SubscriptionItem,
  BillingPortalResult,
} from '../../../types/subscription.js';

/**
 * 订阅服务层
 * 处理所有订阅相关的业务逻辑
 */
export class SubscriptionService {
  private prisma: PrismaClient;
  private stripe: Stripe;

  constructor() {
    this.prisma = prisma;
    this.stripe = stripe;
  }

  /**
   * 创建订阅 Checkout Session
   * 实现 API.md 中的 10 步业务逻辑
   */
  async createCheckoutSession(
    params: CreateCheckoutParams
  ): Promise<CheckoutSessionResult> {
    const { userId, orgId, planKey, moduleKeys } = params;

    logger.info('开始创建 Checkout Session', { userId, orgId, planKey, moduleKeys });

    // ========== 步骤 1: 验证 planKey ==========
    const plan = await this.prisma.plan.findUnique({
      where: { key: planKey },
    });

    if (!plan) {
      throw new AppError(
        'invalid_plan_key',
        'The provided plan key does not exist or is not active',
        400
      );
    }

    if (plan.status !== 'ACTIVE') {
      throw new AppError(
        'invalid_plan_key',
        'The provided plan key does not exist or is not active',
        400
      );
    }

    if (!plan.stripePriceId) {
      throw new AppError(
        'plan_not_synced_to_stripe',
        'The plan has not been synced to Stripe yet. Please contact support.',
        502
      );
    }

    // ========== 步骤 2: 验证 moduleKeys ==========
    let modules: {
      id: string;
      key: string;
      stripePriceId: string | null;
      status: 'ACTIVE' | 'DEPRECATED' | 'SUSPENDED' | 'COMING_SOON';
    }[] = [];

    // 去重后的 moduleKeys（用于数据库查询和验证）
    // 原始 moduleKeys 可能包含重复项（allowMultiple 模块的数量表示）
    const uniqueModuleKeys = [...new Set(moduleKeys)];

    if (uniqueModuleKeys.length > 0) {
      modules = await this.prisma.module.findMany({
        where: {
          key: { in: uniqueModuleKeys },
        },
        select: {
          id: true,
          key: true,
          stripePriceId: true,
          status: true,
        },
      });

      // 检查是否所有 uniqueModuleKey 都找到了
      if (modules.length !== uniqueModuleKeys.length) {
        const foundKeys = modules.map((m) => m.key);
        const missingKeys = uniqueModuleKeys.filter((k) => !foundKeys.includes(k));
        throw new AppError(
          'invalid_module_key',
          `One or more module keys are invalid: ${missingKeys.join(', ')}`,
          400
        );
      }

      // 检查所有模块的状态
      const inactiveModules = modules.filter((m) => m.status !== 'ACTIVE');
      if (inactiveModules.length > 0) {
        throw new AppError(
          'invalid_module_key',
          `One or more module keys are not active: ${inactiveModules.map((m) => m.key).join(', ')}`,
          400
        );
      }

      // 检查是否所有模块都已同步到 Stripe
      const unsyncedModules = modules.filter((m) => !m.stripePriceId);
      if (unsyncedModules.length > 0) {
        throw new AppError(
          'module_not_synced_to_stripe',
          `Module(s) ${unsyncedModules.map((m) => m.key).join(', ')} have not been synced to Stripe`,
          502
        );
      }
    }

    // ========== 步骤 3: 检查 orgId 是否已有活跃订阅 ==========
    const existingSubscription = await this.prisma.subscription.findUnique({
      where: { orgId },
      select: {
        id: true,
        status: true,
        stripeCustomerId: true,
      },
    });

    if (
      existingSubscription &&
      ['trialing', 'active'].includes(existingSubscription.status)
    ) {
      throw new AppError(
        'subscription_exists',
        'This organization already has an active or trialing subscription',
        409
      );
    }

    // ========== 步骤 4: 检查用户 Trial 资格 ==========
    const trialStatus = await this.prisma.userTrialStatus.findUnique({
      where: { userId },
    });

    const hasTrialEligibility = !trialStatus || !trialStatus.hasUsedTrial;

    logger.info('Trial 资格检查', {
      userId,
      hasTrialEligibility,
      trialStatus: trialStatus
        ? { hasUsedTrial: trialStatus.hasUsedTrial }
        : null,
    });

    // ========== 步骤 5: 获取 stripePriceId 并构建 Line Items ==========
    const lineItems: StripeLineItem[] = [
      { price: plan.stripePriceId!, quantity: 1 }, // 基础 Plan
    ];

    // 添加附加模块
    // 使用原始 moduleKeys 计算每个模块的数量（用于 allowMultiple 模块）
    modules.forEach((module) => {
      const quantity = moduleKeys.filter((key) => key === module.key).length;
      lineItems.push({
        price: module.stripePriceId!,
        quantity,
      });
    });

    logger.info('构建 Line Items', { 
      lineItems,
      planPriceId: plan.stripePriceId,
      modulePriceIds: modules.map(m => ({ key: m.key, priceId: m.stripePriceId }))
    });

    // ========== 步骤 6: 获取或创建 Stripe Customer ==========
    let customerId: string;

    if (existingSubscription?.stripeCustomerId) {
      // 复用已有 Customer
      customerId = existingSubscription.stripeCustomerId;
      logger.info('复用已有 Stripe Customer', { customerId });
    } else {
      // 创建新 Customer
      try {
        const customer = await this.stripe.customers.create({
          metadata: {
            orgId,
            userId,
          },
        });
        customerId = customer.id;
        logger.info('创建新 Stripe Customer', { customerId });
      } catch (error) {
        logger.error('创建 Stripe Customer 失败', { error });
        throw new AppError(
          'stripe_error',
          'Failed to create Stripe customer',
          502
        );
      }
    }

    // ========== 步骤 7-8: 构建并创建 Checkout Session ==========
    let session: Stripe.Checkout.Session;

    try {
      const frontendUrl = env.FRONTEND_URL;

      // 构建 subscription_data,只在有 trial 时添加 trial_period_days
      const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData = {
        metadata: {
          orgId,
          planKey,
        },
      };

      if (hasTrialEligibility && plan.trialDurationDays) {
        subscriptionData.trial_period_days = plan.trialDurationDays;
      }

      session = await this.stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        line_items: lineItems,
        success_url: `${frontendUrl}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${frontendUrl}/subscription/cancel`,
        metadata: {
          orgId,
          userId,
          planKey,
          moduleKeys: JSON.stringify(moduleKeys),
        },
        subscription_data: subscriptionData,
      });

      logger.info('Stripe Checkout Session 创建成功', {
        sessionId: session.id,
        checkoutUrl: session.url,
      });
    } catch (error) {
      // 详细记录 Stripe 错误信息
      const stripeError = error as {
        message?: string;
        code?: string;
        type?: string;
        param?: string;
      };
      logger.error('创建 Stripe Checkout Session 失败', {
        message: stripeError.message,
        code: stripeError.code,
        type: stripeError.type,
        param: stripeError.param,
        lineItems,
      });
      throw new AppError(
        'stripe_error',
        stripeError.message || 'Failed to create Stripe checkout session',
        502
      );
    }

    // ========== 步骤 9: 记录到 SubscriptionLog ==========
    // 注意：此时还没有 Subscription 记录，所以 subscriptionId 为 null
    try {
      await this.prisma.subscriptionLog.create({
        data: {
          id: crypto.randomUUID(),
          subscriptionId: null, // checkout 时还没有订阅记录
          action: 'checkout_session_created',
          metadata: {
            sessionId: session.id,
            orgId,
            userId,
            planKey,
            moduleKeys,
            hasTrialEligibility,
          },
        },
      });
      logger.info('SubscriptionLog 记录成功', { sessionId: session.id });
    } catch (error) {
      logger.error('记录 SubscriptionLog 失败', { error });
      // 不影响主流程，继续执行
    }

    // ========== 步骤 10: 返回 Checkout Session URL ==========
    return {
      checkoutUrl: session.url!,
      sessionId: session.id,
      expiresAt: new Date(session.expires_at * 1000), // Unix timestamp 转 Date
    };
  }

  /**
   * 获取组织的订阅详情
   * 从本地数据库读取订阅信息
   */
  async getSubscriptionByOrgId(orgId: string): Promise<SubscriptionDetails> {
    logger.info('获取订阅详情', { orgId });

    // 查询订阅记录
    const subscription = await this.prisma.subscription.findUnique({
      where: { orgId },
      select: {
        orgId: true,
        status: true,
        items: true,
        stripeSubscriptionId: true,
        stripeCustomerId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // 订阅不存在
    if (!subscription) {
      throw new AppError(
        'subscription_not_found',
        'No active subscription found for this organization',
        404
      );
    }

    // 解析 items 字段（JSON 数组）
    const items = subscription.items as unknown as SubscriptionItem[];

    logger.info('订阅详情查询成功', { orgId, status: subscription.status });

    return {
      orgId: subscription.orgId,
      status: subscription.status,
      items,
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      stripeCustomerId: subscription.stripeCustomerId,
      createdAt: subscription.createdAt,
      updatedAt: subscription.updatedAt,
    };
  }

  /**
   * 创建 Billing Portal Session
   * 允许用户在 Stripe Portal 管理订阅
   */
  async createBillingPortalSession(params: {
    orgId: string;
  }): Promise<BillingPortalResult> {
    const { orgId } = params;

    logger.info('创建 Billing Portal Session', { orgId });

    // 查询订阅记录获取 stripeCustomerId
    const subscription = await this.prisma.subscription.findUnique({
      where: { orgId },
      select: {
        id: true,
        stripeCustomerId: true,
        status: true,
      },
    });

    // 订阅不存在
    if (!subscription) {
      throw new AppError(
        'subscription_not_found',
        'No active subscription found for this organization',
        404
      );
    }

    // 调用 Stripe API 创建 Billing Portal Session
    let portalSession: Stripe.BillingPortal.Session;

    try {
      portalSession = await this.stripe.billingPortal.sessions.create({
        customer: subscription.stripeCustomerId,
        return_url: `${env.FRONTEND_URL}/subscription`,
      });

      logger.info('Billing Portal Session 创建成功', {
        orgId,
        portalUrl: portalSession.url,
      });
    } catch (error) {
      logger.error('创建 Billing Portal Session 失败', { error });
      throw new AppError(
        'stripe_error',
        'Failed to create Billing Portal session',
        502
      );
    }

    // 记录到 SubscriptionLog
    try {
      await this.prisma.subscriptionLog.create({
        data: {
          id: crypto.randomUUID(),
          subscriptionId: subscription.id,
          action: 'billing_portal_accessed',
          metadata: {
            orgId,
            portalSessionId: portalSession.id,
          },
        },
      });
      logger.info('SubscriptionLog 记录成功', {
        action: 'billing_portal_accessed',
      });
    } catch (error) {
      logger.error('记录 SubscriptionLog 失败', { error });
      // 不影响主流程，继续执行
    }

    return {
      portalUrl: portalSession.url,
    };
  }
}
