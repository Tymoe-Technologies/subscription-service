import { logger } from '../utils/logger.js';
import { prisma } from '../infra/prisma.js';
import { stripeService } from '../infra/stripe.js';
import Stripe from 'stripe';

/**
 * Part 5: Webhook Service
 * 处理支付商（Stripe/PayPal等）的Webhook事件
 *
 * 支持的事件类型：
 * 1. checkout.session.completed - 结账完成
 * 2. customer.subscription.created - 订阅创建
 * 3. customer.subscription.updated - 订阅更新
 * 4. customer.subscription.deleted - 订阅删除
 * 5. invoice.created - 发票创建
 * 6. invoice.finalized - 发票确定
 * 7. invoice.payment_succeeded - 支付成功
 * 8. invoice.payment_failed - 支付失败
 * 9. payment_method.attached - 支付方式绑定
 * 10. payment_method.detached - 支付方式解绑
 * 11. charge.refunded - 退款
 * 12. customer.updated - 客户更新
 */
export class WebhookService {

  /**
   * 处理Stripe事件（主入口）
   * 包含数据库幂等性保证
   */
  async processStripeEvent(event: Stripe.Event): Promise<void> {
    try {
      // 1. 幂等性检查（使用数据库 - 业界最佳实践）
      const existingEvent = await prisma.webhookEvent.findUnique({
        where: { eventId: event.id }
      });

      if (existingEvent) {
        // 事件已处理，增加attempts计数
        await prisma.webhookEvent.update({
          where: { eventId: event.id },
          data: { attempts: { increment: 1 } }
        });

        logger.info('Webhook event already processed (idempotent)', {
          eventId: event.id,
          eventType: event.type,
          processedAt: existingEvent.processedAt,
          attempts: existingEvent.attempts + 1
        });
        return;
      }

      // 2. 处理事件
      await this.handleEventByType(event);

      // 3. 记录事件为已处理
      await prisma.webhookEvent.create({
        data: {
          eventId: event.id,
          provider: 'stripe',
          eventType: event.type,
          payload: event as any, // 保存原始payload用于调试
          processed: true,
          attempts: 1,
          processedAt: new Date(),
        }
      });

      logger.info('Webhook event processed successfully', {
        eventId: event.id,
        eventType: event.type
      });

    } catch (error) {
      // 记录失败的事件
      try {
        await prisma.webhookEvent.create({
          data: {
            eventId: event.id,
            provider: 'stripe',
            eventType: event.type,
            payload: event as any,
            processed: false,
            attempts: 1,
            error: error instanceof Error ? error.message : String(error),
            processedAt: new Date(),
          }
        });
      } catch (dbError) {
        logger.error('Failed to record failed webhook event', {
          eventId: event.id,
          originalError: error instanceof Error ? error.message : String(error),
          dbError: dbError instanceof Error ? dbError.message : String(dbError)
        });
      }

      logger.error('Failed to process webhook event', {
        eventId: event.id,
        eventType: event.type,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });

      throw error;
    }
  }

  /**
   * 根据事件类型分发处理
   */
  private async handleEventByType(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      // 订阅生命周期事件
      case 'checkout.session.completed':
        await this.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await this.handleSubscriptionChange(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      // 发票和支付事件
      case 'invoice.created':
        await this.handleInvoiceCreated(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.finalized':
        await this.handleInvoiceFinalized(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_succeeded':
        await this.handlePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        await this.handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      // 支付方式事件
      case 'payment_method.attached':
        await this.handlePaymentMethodAttached(event.data.object as Stripe.PaymentMethod);
        break;

      case 'payment_method.detached':
        await this.handlePaymentMethodDetached(event.data.object as Stripe.PaymentMethod);
        break;

      // 退款和客户更新
      case 'charge.refunded':
        await this.handleChargeRefunded(event.data.object as Stripe.Charge);
        break;

      case 'customer.updated':
        await this.handleCustomerUpdated(event.data.object as Stripe.Customer);
        break;

      default:
        logger.info('Unhandled webhook event type', {
          eventType: event.type,
          eventId: event.id
        });
    }
  }

  /**
   * 1. 处理结账完成
   * 场景：Trial转正式、跳过Trial直接订阅
   */
  private async handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    logger.info('Processing checkout.session.completed', {
      sessionId: session.id,
      customerId: session.customer,
      subscriptionId: session.subscription
    });

    if (!session.subscription || !session.customer) {
      logger.warn('Checkout session missing subscription or customer', { sessionId: session.id });
      return;
    }

    // 查找对应的订阅记录（通过Stripe Customer ID）
    const subscription = await prisma.subscription.findFirst({
      where: {
        providerCustomerId: session.customer as string,
        status: 'TRIAL' // 只处理Trial转正式的情况
      }
    });

    if (subscription) {
      // Trial转正式：激活订阅
      const now = new Date();
      const renewsAt = new Date(now);
      renewsAt.setMonth(renewsAt.getMonth() + 1); // 下次续费时间

      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: 'ACTIVE',
          startedAt: now,
          renewsAt: renewsAt,
          trialEndsAt: now, // Trial结束
          paymentProvider: 'stripe',
          updatedAt: now
        }
      });

      // 记录日志
      await prisma.subscriptionLog.create({
        data: {
          subscriptionId: subscription.id,
          action: 'TRIAL_ACTIVATED',
          actorId: 'STRIPE_WEBHOOK',
          details: {
            sessionId: session.id,
            stripeSubscriptionId: session.subscription
          }
        }
      });

      logger.info('Trial subscription activated', {
        subscriptionId: subscription.id,
        orgId: subscription.orgId
      });
    }
  }

  /**
   * 2. 处理订阅创建/更新
   * 场景：订阅续费、升级
   */
  private async handleSubscriptionChange(stripeSubscription: Stripe.Subscription): Promise<void> {
    logger.info('Processing subscription change', {
      stripeSubscriptionId: stripeSubscription.id,
      status: stripeSubscription.status,
      currentPeriodEnd: stripeSubscription.current_period_end
    });

    // 查找本地订阅
    const subscription = await prisma.subscription.findFirst({
      where: { providerCustomerId: stripeSubscription.customer as string }
    });

    if (!subscription) {
      logger.warn('Local subscription not found for Stripe subscription', {
        stripeSubscriptionId: stripeSubscription.id,
        customerId: stripeSubscription.customer
      });
      return;
    }

    // 检查是否是月度续费
    const isRenewal = subscription.renewsAt &&
                     new Date(subscription.renewsAt) <= new Date() &&
                     stripeSubscription.status === 'active';

    if (isRenewal) {
      // 月度续费：重置短信花费和预算警告
      const renewsAt = new Date(stripeSubscription.current_period_end * 1000);

      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: 'ACTIVE',
          renewsAt: renewsAt,
          smsCurrentSpending: 0, // 重置本月短信花费
          smsBudgetAlerts: [], // 清空预算警告
          updatedAt: new Date()
        }
      });

      logger.info('Subscription renewed', {
        subscriptionId: subscription.id,
        nextRenewalDate: renewsAt
      });
    } else {
      // 普通更新
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: this.mapStripeStatus(stripeSubscription.status),
          updatedAt: new Date()
        }
      });
    }

    // 记录日志
    await prisma.subscriptionLog.create({
      data: {
        subscriptionId: subscription.id,
        action: isRenewal ? 'SUBSCRIPTION_RENEWED' : 'SUBSCRIPTION_UPDATED',
        actorId: 'STRIPE_WEBHOOK',
        details: {
          stripeSubscriptionId: stripeSubscription.id,
          status: stripeSubscription.status,
          currentPeriodEnd: stripeSubscription.current_period_end
        }
      }
    });
  }

  /**
   * 3. 处理订阅删除
   */
  private async handleSubscriptionDeleted(stripeSubscription: Stripe.Subscription): Promise<void> {
    logger.info('Processing subscription deleted', {
      stripeSubscriptionId: stripeSubscription.id
    });

    const subscription = await prisma.subscription.findFirst({
      where: { providerCustomerId: stripeSubscription.customer as string }
    });

    if (!subscription) {
      return;
    }

    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        updatedAt: new Date()
      }
    });

    await prisma.subscriptionLog.create({
      data: {
        subscriptionId: subscription.id,
        action: 'SUBSCRIPTION_CANCELLED',
        actorId: 'STRIPE_WEBHOOK',
        details: {
          stripeSubscriptionId: stripeSubscription.id,
          cancelledAt: new Date()
        }
      }
    });

    logger.info('Subscription cancelled', {
      subscriptionId: subscription.id,
      orgId: subscription.orgId
    });
  }

  /**
   * 4. 处理发票创建
   * 关键：在这里将本地 usage 表中的未结算费用同步到 Stripe Invoice
   */
  private async handleInvoiceCreated(stripeInvoice: Stripe.Invoice): Promise<void> {
    logger.info('Processing invoice created', {
      invoiceId: stripeInvoice.id,
      amount: stripeInvoice.amount_due,
      customerId: stripeInvoice.customer
    });

    // 只处理订阅相关的发票
    if (!stripeInvoice.subscription) {
      logger.info('Skipping non-subscription invoice', {
        invoiceId: stripeInvoice.id
      });
      return;
    }

    try {
      // 1. 查找本地订阅
      const subscription = await prisma.subscription.findFirst({
        where: { 
          providerCustomerId: stripeInvoice.customer as string 
        }
      });

      if (!subscription) {
        logger.warn('Subscription not found for invoice', {
          invoiceId: stripeInvoice.id,
          customerId: stripeInvoice.customer
        });
        return;
      }

      // 2. 查询本账单周期的未结算费用
      const periodStart = new Date(stripeInvoice.period_start * 1000);
      const periodEnd = new Date(stripeInvoice.period_end * 1000);

      const unbilledUsages = await prisma.usage.findMany({
        where: {
          subscriptionId: subscription.id,
          billedAt: null,
          createdAt: {
            gte: periodStart,
            lt: periodEnd
          }
        },
        orderBy: {
          createdAt: 'asc'
        }
      });

      if (unbilledUsages.length === 0) {
        logger.info('No unbilled usage to sync', {
          invoiceId: stripeInvoice.id,
          subscriptionId: subscription.id
        });
        return;
      }

      // 3. 按类型汇总费用（用于日志）
      const usageSummary = this.summarizeUsages(unbilledUsages);
      
      logger.info('Syncing usage to Stripe invoice', {
        invoiceId: stripeInvoice.id,
        subscriptionId: subscription.id,
        usageCount: unbilledUsages.length,
        summary: usageSummary
      });

      // 4. 为每条费用创建 Stripe Invoice Item
      const syncedUsageIds: string[] = [];
      
      for (const usage of unbilledUsages) {
        try {
          // 跳过免费使用量（trial期间）
          if (usage.isFree || usage.amount.toNumber() === 0) {
            await prisma.usage.update({
              where: { id: usage.id },
              data: { 
                billedAt: new Date()
              }
            });
            syncedUsageIds.push(usage.id);
            continue;
          }

          // 创建 Stripe Invoice Item
          await stripeService.stripe.invoiceItems.create({
            customer: stripeInvoice.customer as string,
            invoice: stripeInvoice.id,
            amount: Math.round(usage.amount.toNumber() * 100), // 转为cents
            currency: 'cad',
            description: this.getUsageDescription(usage),
            metadata: {
              usageId: usage.id,
              usageType: usage.usageType,
              quantity: usage.quantity.toString(),
              subscriptionId: subscription.id
            }
          });

          // 标记为已结算
          await prisma.usage.update({
            where: { id: usage.id },
            data: { 
              billedAt: new Date()
            }
          });

          syncedUsageIds.push(usage.id);

        } catch (error) {
          logger.error('Failed to sync single usage to Stripe', {
            usageId: usage.id,
            error: error instanceof Error ? error.message : String(error)
          });
          // 继续处理其他usage，不中断整个流程
        }
      }

      logger.info('Usage sync completed', {
        invoiceId: stripeInvoice.id,
        subscriptionId: subscription.id,
        totalSynced: syncedUsageIds.length,
        totalAmount: unbilledUsages
          .filter(u => syncedUsageIds.includes(u.id))
          .reduce((sum, u) => sum + u.amount.toNumber(), 0)
      });

    } catch (error) {
      logger.error('Failed to process invoice created', {
        invoiceId: stripeInvoice.id,
        error: error instanceof Error ? error.message : String(error)
      });
      // 不抛出异常，避免webhook重试死循环
    }
  }

  /**
   * 5. 处理发票确定
   */
  private async handleInvoiceFinalized(stripeInvoice: Stripe.Invoice): Promise<void> {
    logger.info('Processing invoice finalized', {
      invoiceId: stripeInvoice.id,
      amount: stripeInvoice.amount_due
    });

    // 发票确定后等待支付
  }

  /**
   * 6. 处理支付成功
   * 场景：首次支付、月度续费、按天计费
   */
  private async handlePaymentSucceeded(stripeInvoice: Stripe.Invoice): Promise<void> {
    logger.info('Processing payment succeeded', {
      invoiceId: stripeInvoice.id,
      subscriptionId: stripeInvoice.subscription,
      amount: stripeInvoice.amount_paid
    });

    if (!stripeInvoice.subscription) {
      return;
    }

    // 查找订阅
    const subscription = await prisma.subscription.findFirst({
      where: { providerCustomerId: stripeInvoice.customer as string }
    });

    if (!subscription) {
      return;
    }

    // 更新订阅状态为ACTIVE
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'ACTIVE',
        gracePeriodEndsAt: null, // 清除宽限期
        graceAlertSent: false, // 重置宽限期警告
        updatedAt: new Date()
      }
    });

    // 创建或更新Invoice记录
    const existingInvoice = await prisma.invoice.findFirst({
      where: { providerInvoiceId: stripeInvoice.id }
    });

    if (!existingInvoice) {
      // 生成发票号
      const invoiceNumber = await this.generateInvoiceNumber();

      await prisma.invoice.create({
        data: {
          subscriptionId: subscription.id,
          periodStart: new Date(stripeInvoice.period_start * 1000),
          periodEnd: new Date(stripeInvoice.period_end * 1000),
          items: stripeInvoice.lines.data as any,
          subtotal: Number(stripeInvoice.subtotal) / 100,
          discount: Number(stripeInvoice.discount || 0) / 100,
          tax: Number(stripeInvoice.tax || 0) / 100,
          total: Number(stripeInvoice.amount_paid) / 100,
          status: 'PAID',
          paidAt: new Date(),
          paymentProvider: 'stripe',
          providerInvoiceId: stripeInvoice.id,
          providerMetadata: stripeInvoice as any,
          number: invoiceNumber,
          pdfUrl: stripeInvoice.invoice_pdf || null
        }
      });
    } else {
      await prisma.invoice.update({
        where: { id: existingInvoice.id },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          updatedAt: new Date()
        }
      });
    }

    await prisma.subscriptionLog.create({
      data: {
        subscriptionId: subscription.id,
        action: 'PAYMENT_SUCCEEDED',
        actorId: 'STRIPE_WEBHOOK',
        details: {
          invoiceId: stripeInvoice.id,
          amount: stripeInvoice.amount_paid / 100
        }
      }
    });

    logger.info('Payment processed successfully', {
      subscriptionId: subscription.id,
      invoiceId: stripeInvoice.id
    });
  }

  /**
   * 7. 处理支付失败
   * 场景：支付失败 → 设置7天宽限期
   */
  private async handlePaymentFailed(stripeInvoice: Stripe.Invoice): Promise<void> {
    logger.info('Processing payment failed', {
      invoiceId: stripeInvoice.id,
      subscriptionId: stripeInvoice.subscription
    });

    if (!stripeInvoice.subscription) {
      return;
    }

    const subscription = await prisma.subscription.findFirst({
      where: { providerCustomerId: stripeInvoice.customer as string }
    });

    if (!subscription) {
      return;
    }

    // 设置7天宽限期
    const gracePeriodEndsAt = new Date();
    gracePeriodEndsAt.setDate(gracePeriodEndsAt.getDate() + 7);

    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'SUSPENDED',
        gracePeriodEndsAt: gracePeriodEndsAt,
        graceAlertSent: false, // 允许发送宽限期警告
        updatedAt: new Date()
      }
    });

    // 更新Invoice状态
    const existingInvoice = await prisma.invoice.findFirst({
      where: { providerInvoiceId: stripeInvoice.id }
    });

    if (existingInvoice) {
      await prisma.invoice.update({
        where: { id: existingInvoice.id },
        data: {
          status: 'FAILED',
          failureReason: stripeInvoice.last_finalization_error?.message || 'Payment failed',
          retryCount: { increment: 1 },
          updatedAt: new Date()
        }
      });
    }

    await prisma.subscriptionLog.create({
      data: {
        subscriptionId: subscription.id,
        action: 'PAYMENT_FAILED',
        actorId: 'STRIPE_WEBHOOK',
        details: {
          invoiceId: stripeInvoice.id,
          gracePeriodEndsAt: gracePeriodEndsAt,
          error: stripeInvoice.last_finalization_error?.message
        }
      }
    });

    logger.warn('Payment failed, subscription suspended with grace period', {
      subscriptionId: subscription.id,
      gracePeriodEndsAt: gracePeriodEndsAt
    });
  }

  /**
   * 8. 处理支付方式绑定
   */
  private async handlePaymentMethodAttached(paymentMethod: Stripe.PaymentMethod): Promise<void> {
    logger.info('Processing payment method attached', {
      paymentMethodId: paymentMethod.id,
      customerId: paymentMethod.customer
    });

    if (!paymentMethod.customer) {
      return;
    }

    // 查找用户（通过Stripe Customer ID）
    const subscription = await prisma.subscription.findFirst({
      where: { providerCustomerId: paymentMethod.customer as string }
    });

    if (!subscription) {
      return;
    }

    // 更新或创建PaymentMethod记录
    await prisma.paymentMethod.upsert({
      where: {
        userId: subscription.payerId,
      },
      create: {
        userId: subscription.payerId,
        provider: 'stripe',
        providerMethodId: paymentMethod.id,
        providerMetadata: paymentMethod as any,
        brand: paymentMethod.card?.brand || null,
        last4: paymentMethod.card?.last4 || null,
        expiresAt: paymentMethod.card ?
          new Date(paymentMethod.card.exp_year, paymentMethod.card.exp_month - 1) :
          null,
        isDefault: true,
        isActive: true
      },
      update: {
        providerMethodId: paymentMethod.id,
        providerMetadata: paymentMethod as any,
        brand: paymentMethod.card?.brand || null,
        last4: paymentMethod.card?.last4 || null,
        expiresAt: paymentMethod.card ?
          new Date(paymentMethod.card.exp_year, paymentMethod.card.exp_month - 1) :
          null,
        updatedAt: new Date()
      }
    });

    logger.info('Payment method attached', {
      userId: subscription.payerId,
      paymentMethodId: paymentMethod.id
    });
  }

  /**
   * 9. 处理支付方式解绑
   */
  private async handlePaymentMethodDetached(paymentMethod: Stripe.PaymentMethod): Promise<void> {
    logger.info('Processing payment method detached', {
      paymentMethodId: paymentMethod.id
    });

    // 标记支付方式为不活跃
    await prisma.paymentMethod.updateMany({
      where: { providerMethodId: paymentMethod.id },
      data: {
        isActive: false,
        updatedAt: new Date()
      }
    });
  }

  /**
   * 10. 处理退款
   */
  private async handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
    logger.info('Processing charge refunded', {
      chargeId: charge.id,
      amount: charge.amount_refunded
    });

    if (!charge.invoice) {
      return;
    }

    // 查找对应的Invoice
    const invoice = await prisma.invoice.findFirst({
      where: { providerInvoiceId: charge.invoice as string }
    });

    if (!invoice) {
      return;
    }

    // 更新Invoice状态为REFUNDED
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: 'REFUNDED',
        updatedAt: new Date()
      }
    });

    // 记录日志
    await prisma.subscriptionLog.create({
      data: {
        subscriptionId: invoice.subscriptionId,
        action: 'CHARGE_REFUNDED',
        actorId: 'STRIPE_WEBHOOK',
        details: {
          chargeId: charge.id,
          invoiceId: invoice.id,
          amountRefunded: charge.amount_refunded / 100
        }
      }
    });

    logger.info('Charge refunded', {
      invoiceId: invoice.id,
      amount: charge.amount_refunded / 100
    });
  }

  /**
   * 11. 处理客户更新
   */
  private async handleCustomerUpdated(customer: Stripe.Customer): Promise<void> {
    logger.info('Processing customer updated', {
      customerId: customer.id,
      email: customer.email
    });

    // 更新Subscription的provider metadata
    await prisma.subscription.updateMany({
      where: { providerCustomerId: customer.id },
      data: {
        providerMetadata: customer as any,
        updatedAt: new Date()
      }
    });
  }

  /**
   * 生成用户友好的 Usage 描述（用于 Stripe Invoice Item）
   */
  private getUsageDescription(usage: any): string {
    const usageType = usage.usageType;
    const quantity = usage.quantity;
    const metadata = usage.metadata || {};

    const descriptions: Record<string, string> = {
      'sms': `短信服务 (${quantity} 条)`,
      'email': `邮件服务 (${quantity} 封)`,
      'module_prorated': `模块: ${metadata.moduleName || metadata.moduleKey || 'Unknown'} (按比例计费)`,
      'resource_prorated': `资源: ${metadata.resourceName || metadata.resourceType || 'Unknown'} (${quantity} 单位, 按比例计费)`
    };

    return descriptions[usageType] || `使用量: ${usageType} (${quantity} 单位)`;
  }

  /**
   * 汇总 Usage 费用（用于日志）
   */
  private summarizeUsages(usages: any[]): Record<string, any> {
    const summary: Record<string, any> = {};

    for (const usage of usages) {
      const type = usage.usageType;
      if (!summary[type]) {
        summary[type] = {
          count: 0,
          quantity: 0,
          amount: 0,
          freeCount: 0
        };
      }
      
      summary[type].count += 1;
      summary[type].quantity += usage.quantity;
      summary[type].amount += usage.amount.toNumber();
      if (usage.isFree) {
        summary[type].freeCount += 1;
      }
    }

    return summary;
  }

  /**
   * 生成发票号
   * 格式：INV-2025-01-001
   */
  private async generateInvoiceNumber(): Promise<string> {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');

    // 获取本月的发票数量
    const startOfMonth = new Date(year, now.getMonth(), 1);
    const endOfMonth = new Date(year, now.getMonth() + 1, 0, 23, 59, 59);

    const count = await prisma.invoice.count({
      where: {
        createdAt: {
          gte: startOfMonth,
          lte: endOfMonth
        }
      }
    });

    const sequence = String(count + 1).padStart(3, '0');
    return `INV-${year}-${month}-${sequence}`;
  }

  /**
   * 映射Stripe订阅状态到本地状态
   */
  private mapStripeStatus(stripeStatus: string): 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'CANCELLED' {
    switch (stripeStatus.toLowerCase()) {
      case 'trialing':
        return 'TRIAL';
      case 'active':
        return 'ACTIVE';
      case 'past_due':
        return 'SUSPENDED';
      case 'canceled':
      case 'cancelled':
        return 'CANCELLED';
      case 'unpaid':
      case 'incomplete_expired':
        return 'EXPIRED';
      default:
        logger.warn('Unknown Stripe status, defaulting to CANCELLED', { stripeStatus });
        return 'CANCELLED';
    }
  }
}

export const webhookService = new WebhookService();
