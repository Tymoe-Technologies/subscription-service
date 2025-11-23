import { v4 as uuidv4 } from 'uuid';
import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import { prisma } from '../../../infra/prisma.js';
import { stripe } from '../../../infra/stripe.js';
import { logger } from '../../../utils/logger.js';
import {
  SubscriptionItemData,
  CheckoutMetadata,
  WebhookProcessResult,
  isSupportedEvent,
} from '../../../types/webhook.js';

/**
 * Webhook 服务层
 * 处理 Stripe Webhook 事件，同步到本地数据库
 */
export class WebhookService {
  private prisma: PrismaClient;
  private stripe: Stripe;

  constructor() {
    this.prisma = prisma;
    this.stripe = stripe;
  }

  /**
   * 处理 Stripe Webhook 事件
   * 主入口方法
   */
  async processEvent(event: Stripe.Event): Promise<WebhookProcessResult> {
    const eventId = event.id;
    const eventType = event.type;

    logger.info('开始处理 Stripe Webhook 事件', { eventId, eventType });

    // 1. 幂等性检查 - 检查事件是否已处理过
    const existingEvent = await this.prisma.webhookEvent.findUnique({
      where: { stripeEventId: eventId },
    });

    if (existingEvent) {
      logger.info('事件已处理过，跳过', { eventId, status: existingEvent.status });
      return {
        success: true,
        eventId,
        eventType,
        message: 'Event already processed',
      };
    }

    // 2. 记录事件到 WebhookEvent 表
    const webhookEventId = uuidv4();
    await this.prisma.webhookEvent.create({
      data: {
        id: webhookEventId,
        stripeEventId: eventId,
        eventType,
        payload: event as unknown as object,
        status: 'processing',
      },
    });

    try {
      // 3. 根据事件类型分发处理
      if (!isSupportedEvent(eventType)) {
        logger.info('不支持的事件类型，忽略', { eventType });
        await this.updateWebhookEventStatus(webhookEventId, 'processed');
        return {
          success: true,
          eventId,
          eventType,
          message: 'Event type not supported, ignored',
        };
      }

      // 4. 处理具体事件
      switch (eventType) {
        case 'checkout.session.completed':
          await this.handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
          break;

        case 'customer.subscription.created':
          await this.handleSubscriptionCreated(event.data.object as Stripe.Subscription);
          break;

        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
          break;

        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
          break;

        case 'invoice.payment_succeeded':
          await this.handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
          break;

        case 'invoice.payment_failed':
          await this.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
          break;
      }

      // 5. 更新事件状态为已处理
      await this.updateWebhookEventStatus(webhookEventId, 'processed');

      logger.info('Webhook 事件处理成功', { eventId, eventType });
      return {
        success: true,
        eventId,
        eventType,
        message: 'Event processed successfully',
      };
    } catch (error) {
      // 6. 处理失败，记录错误
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.updateWebhookEventStatus(webhookEventId, 'failed', errorMessage);

      logger.error('Webhook 事件处理失败', { eventId, eventType, error: errorMessage });
      throw error;
    }
  }

  /**
   * 处理 checkout.session.completed 事件
   * 用户完成 Stripe Checkout 支付后触发
   */
  private async handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
    logger.info('处理 checkout.session.completed', { sessionId: session.id });

    // 1. 获取 metadata
    const metadata = session.metadata as unknown as CheckoutMetadata;
    if (!metadata?.userId || !metadata?.orgId || !metadata?.planKey) {
      logger.error('Checkout session metadata 缺失必要字段', { metadata });
      throw new Error('Invalid checkout session metadata');
    }

    const { userId, orgId, planKey } = metadata;
    const moduleKeys: string[] = metadata.moduleKeys ? JSON.parse(metadata.moduleKeys) : [];

    // 2. 获取 Stripe Subscription 详情
    if (!session.subscription) {
      logger.error('Checkout session 没有关联的 subscription', { sessionId: session.id });
      throw new Error('No subscription associated with checkout session');
    }

    const stripeSubscription = await this.stripe.subscriptions.retrieve(
      session.subscription as string,
      { expand: ['items.data.price.product'] }
    );

    // 3. 构建订阅项目数据
    const items = await this.buildSubscriptionItems(stripeSubscription, planKey, moduleKeys);

    // 4. 检查是否已存在订阅记录（防止重复创建）
    const existingSubscription = await this.prisma.subscription.findUnique({
      where: { orgId },
    });

    if (existingSubscription) {
      // 更新现有订阅
      await this.prisma.subscription.update({
        where: { orgId },
        data: {
          payerId: userId,
          stripeCustomerId: session.customer as string,
          stripeSubscriptionId: stripeSubscription.id,
          status: stripeSubscription.status,
          items: items as unknown as object,
          updatedAt: new Date(),
        },
      });
      logger.info('更新已有订阅记录', { orgId, subscriptionId: stripeSubscription.id });
    } else {
      // 创建新订阅记录
      await this.prisma.subscription.create({
        data: {
          id: uuidv4(),
          orgId,
          payerId: userId,
          stripeCustomerId: session.customer as string,
          stripeSubscriptionId: stripeSubscription.id,
          status: stripeSubscription.status,
          items: items as unknown as object,
          updatedAt: new Date(),
        },
      });
      logger.info('创建新订阅记录', { orgId, subscriptionId: stripeSubscription.id });
    }

    // 5. 更新用户 Trial 状态
    if (stripeSubscription.status === 'trialing') {
      await this.updateUserTrialStatus(userId, orgId);
    }

    // 6. 记录订阅日志
    await this.createSubscriptionLog(orgId, 'checkout_completed', {
      sessionId: session.id,
      subscriptionId: stripeSubscription.id,
      planKey,
      moduleKeys,
    });
  }

  /**
   * 处理 customer.subscription.created 事件
   * 通常在 checkout.session.completed 之后触发，可能已经处理过
   */
  private async handleSubscriptionCreated(subscription: Stripe.Subscription): Promise<void> {
    logger.info('处理 customer.subscription.created', { subscriptionId: subscription.id });

    // 检查是否已有记录（可能已在 checkout.session.completed 中创建）
    const existing = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (existing) {
      logger.info('订阅记录已存在，跳过创建', { subscriptionId: subscription.id });
      return;
    }

    // 如果没有记录，说明可能是通过其他方式创建的订阅（如 Stripe Dashboard）
    // 此时 metadata 可能不完整，记录警告
    logger.warn('收到 subscription.created 但本地无记录，可能需要手动处理', {
      subscriptionId: subscription.id,
      customerId: subscription.customer,
    });
  }

  /**
   * 处理 customer.subscription.updated 事件
   * 订阅变更（升级/降级/修改）时触发
   */
  private async handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    logger.info('处理 customer.subscription.updated', {
      subscriptionId: subscription.id,
      status: subscription.status,
    });

    // 1. 查找本地订阅记录
    const localSubscription = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (!localSubscription) {
      logger.warn('本地无此订阅记录，跳过更新', { subscriptionId: subscription.id });
      return;
    }

    // 2. 从 Stripe 订阅解析 items
    const expandedSubscription = await this.stripe.subscriptions.retrieve(subscription.id, {
      expand: ['items.data.price.product'],
    });

    const items = await this.parseSubscriptionItems(expandedSubscription);

    // 3. 更新本地记录
    await this.prisma.subscription.update({
      where: { stripeSubscriptionId: subscription.id },
      data: {
        status: subscription.status,
        items: items as unknown as object,
        updatedAt: new Date(),
      },
    });

    // 4. 记录日志
    await this.createSubscriptionLog(localSubscription.orgId, 'subscription_updated', {
      subscriptionId: subscription.id,
      newStatus: subscription.status,
      previousStatus: localSubscription.status,
    });

    logger.info('订阅更新成功', {
      orgId: localSubscription.orgId,
      subscriptionId: subscription.id,
      status: subscription.status,
    });
  }

  /**
   * 处理 customer.subscription.deleted 事件
   * 订阅被取消或到期时触发
   */
  private async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    logger.info('处理 customer.subscription.deleted', { subscriptionId: subscription.id });

    // 1. 查找本地订阅记录
    const localSubscription = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (!localSubscription) {
      logger.warn('本地无此订阅记录，跳过删除处理', { subscriptionId: subscription.id });
      return;
    }

    // 2. 更新状态为 canceled（不删除记录，保留历史）
    await this.prisma.subscription.update({
      where: { stripeSubscriptionId: subscription.id },
      data: {
        status: 'canceled',
        updatedAt: new Date(),
      },
    });

    // 3. 记录日志
    await this.createSubscriptionLog(localSubscription.orgId, 'subscription_deleted', {
      subscriptionId: subscription.id,
      canceledAt: subscription.canceled_at,
    });

    logger.info('订阅取消成功', {
      orgId: localSubscription.orgId,
      subscriptionId: subscription.id,
    });
  }

  /**
   * 处理 invoice.payment_succeeded 事件
   * 支付成功时触发（首次支付或续费）
   */
  private async handleInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
    logger.info('处理 invoice.payment_succeeded', {
      invoiceId: invoice.id,
      subscriptionId: invoice.subscription,
    });

    if (!invoice.subscription) {
      logger.info('Invoice 非订阅相关，跳过', { invoiceId: invoice.id });
      return;
    }

    // 查找本地订阅
    const localSubscription = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: invoice.subscription as string },
    });

    if (!localSubscription) {
      logger.warn('本地无此订阅记录', { subscriptionId: invoice.subscription });
      return;
    }

    // 如果状态是 past_due，恢复为 active
    if (localSubscription.status === 'past_due') {
      await this.prisma.subscription.update({
        where: { stripeSubscriptionId: invoice.subscription as string },
        data: {
          status: 'active',
          updatedAt: new Date(),
        },
      });

      logger.info('订阅状态从 past_due 恢复为 active', {
        orgId: localSubscription.orgId,
      });
    }

    // 记录日志
    await this.createSubscriptionLog(localSubscription.orgId, 'payment_succeeded', {
      invoiceId: invoice.id,
      amountPaid: invoice.amount_paid,
      currency: invoice.currency,
    });
  }

  /**
   * 处理 invoice.payment_failed 事件
   * 支付失败时触发（续费失败等）
   */
  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    logger.info('处理 invoice.payment_failed', {
      invoiceId: invoice.id,
      subscriptionId: invoice.subscription,
    });

    if (!invoice.subscription) {
      logger.info('Invoice 非订阅相关，跳过', { invoiceId: invoice.id });
      return;
    }

    // 查找本地订阅
    const localSubscription = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: invoice.subscription as string },
    });

    if (!localSubscription) {
      logger.warn('本地无此订阅记录', { subscriptionId: invoice.subscription });
      return;
    }

    // 更新状态为 past_due
    await this.prisma.subscription.update({
      where: { stripeSubscriptionId: invoice.subscription as string },
      data: {
        status: 'past_due',
        updatedAt: new Date(),
      },
    });

    // 记录日志
    await this.createSubscriptionLog(localSubscription.orgId, 'payment_failed', {
      invoiceId: invoice.id,
      attemptCount: invoice.attempt_count,
    });

    logger.warn('订阅支付失败，状态更新为 past_due', {
      orgId: localSubscription.orgId,
      subscriptionId: invoice.subscription,
    });
  }

  /**
   * 构建订阅项目数据（从 checkout 创建时使用）
   */
  private async buildSubscriptionItems(
    subscription: Stripe.Subscription,
    planKey: string,
    moduleKeys: string[]
  ): Promise<SubscriptionItemData[]> {
    const items: SubscriptionItemData[] = [];

    // 获取 Plan 信息
    const plan = await this.prisma.plan.findUnique({
      where: { key: planKey },
      select: { name: true, stripePriceId: true },
    });

    if (plan) {
      items.push({
        type: 'plan',
        key: planKey,
        name: plan.name,
        stripePriceId: plan.stripePriceId || '',
        quantity: 1,
      });
    }

    // 获取 Module 信息
    if (moduleKeys.length > 0) {
      const modules = await this.prisma.module.findMany({
        where: { key: { in: moduleKeys } },
        select: { key: true, name: true, stripePriceId: true },
      });

      // 统计每个 module 的购买数量
      const moduleQuantityMap = new Map<string, number>();
      for (const item of subscription.items.data) {
        const product = item.price.product as Stripe.Product | string;
        const productId = typeof product === 'string' ? product : product.id;

        // 查找对应的 module
        const matchedModule = modules.find((m) => m.stripePriceId === item.price.id);
        if (matchedModule) {
          moduleQuantityMap.set(
            matchedModule.key,
            (moduleQuantityMap.get(matchedModule.key) || 0) + (item.quantity || 1)
          );
        }
      }

      for (const module of modules) {
        items.push({
          type: 'module',
          key: module.key,
          name: module.name,
          stripePriceId: module.stripePriceId || '',
          quantity: moduleQuantityMap.get(module.key) || 1,
        });
      }
    }

    return items;
  }

  /**
   * 从 Stripe Subscription 解析订阅项目（更新时使用）
   */
  private async parseSubscriptionItems(
    subscription: Stripe.Subscription
  ): Promise<SubscriptionItemData[]> {
    const items: SubscriptionItemData[] = [];

    // 获取所有 Plans 和 Modules 的 stripePriceId 映射
    const [plans, modules] = await Promise.all([
      this.prisma.plan.findMany({
        select: { key: true, name: true, stripePriceId: true },
      }),
      this.prisma.module.findMany({
        select: { key: true, name: true, stripePriceId: true },
      }),
    ]);

    const priceToProduct = new Map<string, { type: 'plan' | 'module'; key: string; name: string }>();

    for (const plan of plans) {
      if (plan.stripePriceId) {
        priceToProduct.set(plan.stripePriceId, {
          type: 'plan',
          key: plan.key,
          name: plan.name,
        });
      }
    }

    for (const module of modules) {
      if (module.stripePriceId) {
        priceToProduct.set(module.stripePriceId, {
          type: 'module',
          key: module.key,
          name: module.name,
        });
      }
    }

    // 解析订阅项目
    for (const item of subscription.items.data) {
      const priceId = item.price.id;
      const product = priceToProduct.get(priceId);

      if (product) {
        items.push({
          type: product.type,
          key: product.key,
          name: product.name,
          stripePriceId: priceId,
          quantity: item.quantity || 1,
        });
      } else {
        // 未知产品，记录原始数据
        logger.warn('未知的 Stripe Price ID', { priceId });
        const stripeProduct = item.price.product as Stripe.Product;
        items.push({
          type: 'module', // 默认为 module
          key: `unknown_${priceId}`,
          name: typeof stripeProduct === 'string' ? 'Unknown Product' : stripeProduct.name,
          stripePriceId: priceId,
          quantity: item.quantity || 1,
        });
      }
    }

    return items;
  }

  /**
   * 更新用户 Trial 状态
   */
  private async updateUserTrialStatus(userId: string, orgId: string): Promise<void> {
    const existing = await this.prisma.userTrialStatus.findUnique({
      where: { userId },
    });

    if (existing) {
      // 如果已存在且未使用过 trial，更新为已使用
      if (!existing.hasUsedTrial) {
        await this.prisma.userTrialStatus.update({
          where: { userId },
          data: {
            hasUsedTrial: true,
            trialActivatedAt: new Date(),
            initialTrialOrgIds: [orgId],
            updatedAt: new Date(),
          },
        });
        logger.info('更新用户 Trial 状态', { userId, hasUsedTrial: true });
      }
    } else {
      // 创建新记录
      await this.prisma.userTrialStatus.create({
        data: {
          id: uuidv4(),
          userId,
          hasUsedTrial: true,
          trialActivatedAt: new Date(),
          initialTrialOrgIds: [orgId],
          updatedAt: new Date(),
        },
      });
      logger.info('创建用户 Trial 状态记录', { userId });
    }
  }

  /**
   * 更新 WebhookEvent 状态
   */
  private async updateWebhookEventStatus(
    id: string,
    status: 'processed' | 'failed',
    error?: string
  ): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id },
      data: {
        status,
        error: error || null,
        processedAt: new Date(),
      },
    });
  }

  /**
   * 创建订阅操作日志
   */
  private async createSubscriptionLog(
    orgId: string,
    action: string,
    metadata: object
  ): Promise<void> {
    // 查找订阅 ID
    const subscription = await this.prisma.subscription.findUnique({
      where: { orgId },
      select: { id: true },
    });

    await this.prisma.subscriptionLog.create({
      data: {
        id: uuidv4(),
        subscriptionId: subscription?.id || null,
        action,
        metadata,
      },
    });
  }
}

export const webhookService = new WebhookService();
