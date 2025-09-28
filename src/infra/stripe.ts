import Stripe from 'stripe';
import { service } from '../config/config.js';
import { logger } from '../utils/logger.js';

// 初始化Stripe客户端
export const stripe = new Stripe(service.stripe.secretKey, {
  apiVersion: '2023-10-16',
  typescript: true,
});

// Stripe工具类
export class StripeService {
  private stripe: Stripe;

  constructor() {
    this.stripe = stripe;
  }

  // 创建客户
  async createCustomer(params: {
    email?: string;
    name: string;
    organizationId: string;
  }): Promise<Stripe.Customer> {
    const customerData: Stripe.CustomerCreateParams = {
      name: params.name,
      metadata: {
        organizationId: params.organizationId,
      },
    };

    if (params.email) {
      customerData.email = params.email;
    }

    return await this.stripe.customers.create(customerData);
  }

  // 获取客户
  async getCustomer(customerId: string): Promise<Stripe.Customer | null> {
    try {
      const customer = await this.stripe.customers.retrieve(customerId);
      return customer.deleted ? null : customer;
    } catch (error) {
      logger.error('获取Stripe客户失败:', error);
      return null;
    }
  }

  // 更新客户
  async updateCustomer(
    customerId: string,
    params: {
      name?: string;
      email?: string;
    }
  ): Promise<Stripe.Customer> {
    return await this.stripe.customers.update(customerId, params);
  }

  // 创建订阅
  async createSubscription(params: {
    customerId: string;
    priceId: string;
    trialPeriodDays?: number;
    metadata?: Record<string, string>;
  }): Promise<Stripe.Subscription> {
    const subscriptionParams: Stripe.SubscriptionCreateParams = {
      customer: params.customerId,
      items: [{ price: params.priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
    };

    if (params.trialPeriodDays) {
      subscriptionParams.trial_period_days = params.trialPeriodDays;
    }

    if (params.metadata) {
      subscriptionParams.metadata = params.metadata;
    }

    return await this.stripe.subscriptions.create(subscriptionParams);
  }

  // 获取订阅
  async getSubscription(subscriptionId: string): Promise<Stripe.Subscription | null> {
    try {
      return await this.stripe.subscriptions.retrieve(subscriptionId);
    } catch (error) {
      logger.error('获取Stripe订阅失败:', error);
      return null;
    }
  }

  // 更新订阅
  async updateSubscription(
    subscriptionId: string,
    params: Stripe.SubscriptionUpdateParams
  ): Promise<Stripe.Subscription> {
    return await this.stripe.subscriptions.update(subscriptionId, params);
  }

  // 取消订阅
  async cancelSubscription(
    subscriptionId: string,
    cancelAtPeriodEnd: boolean = true
  ): Promise<Stripe.Subscription> {
    if (cancelAtPeriodEnd) {
      return await this.stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
      });
    } else {
      return await this.stripe.subscriptions.cancel(subscriptionId);
    }
  }

  // 创建价格
  async createPrice(params: {
    productId: string;
    unitAmount: number;
    currency: string;
    interval: 'month' | 'year';
    metadata?: Record<string, string>;
  }): Promise<Stripe.Price> {
    return await this.stripe.prices.create({
      product: params.productId,
      unit_amount: params.unitAmount,
      currency: params.currency,
      recurring: {
        interval: params.interval,
      },
      ...(params.metadata && { metadata: params.metadata }),
    });
  }

  // 获取价格
  async getPrice(priceId: string): Promise<Stripe.Price | null> {
    try {
      return await this.stripe.prices.retrieve(priceId);
    } catch (error) {
      logger.error('获取Stripe价格失败:', error);
      return null;
    }
  }

  // 列出客户的订阅
  async listCustomerSubscriptions(customerId: string): Promise<Stripe.Subscription[]> {
    try {
      const subscriptions = await this.stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
      });
      return subscriptions.data;
    } catch (error) {
      logger.error('获取客户订阅列表失败:', error);
      return [];
    }
  }

  // 验证webhook签名
  verifyWebhookSignature(payload: string, signature: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(payload, signature, service.stripe.webhookSecret);
  }

  // 创建计费门户会话
  async createBillingPortalSession(params: {
    customerId: string;
    returnUrl: string;
  }): Promise<Stripe.BillingPortal.Session> {
    return await this.stripe.billingPortal.sessions.create({
      customer: params.customerId,
      return_url: params.returnUrl,
    });
  }

  // 创建结账会话
  async createCheckoutSession(params: {
    customerId?: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    trialPeriodDays?: number;
    metadata?: Record<string, string>;
  }): Promise<Stripe.Checkout.Session> {
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: 'subscription',
      line_items: [
        {
          price: params.priceId,
          quantity: 1,
        },
      ],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    };

    if (params.customerId) {
      sessionParams.customer = params.customerId;
    }

    if (params.trialPeriodDays) {
      sessionParams.subscription_data = {
        trial_period_days: params.trialPeriodDays,
      };
    }

    if (params.metadata) {
      sessionParams.subscription_data = {
        ...sessionParams.subscription_data,
        metadata: params.metadata,
      };
    }

    return await this.stripe.checkout.sessions.create(sessionParams);
  }
}

export const stripeService = new StripeService();
