/**
 * Webhook API 相关的类型定义
 */

import Stripe from 'stripe';

/**
 * Webhook 事件处理状态
 */
export type WebhookEventStatus = 'received' | 'processing' | 'processed' | 'failed';

/**
 * 订阅项目（存储在 Subscription.items JSON 字段中）
 */
export interface SubscriptionItemData {
  type: 'plan' | 'module';
  key: string;
  name: string;
  stripePriceId: string;
  quantity: number;
}

/**
 * Checkout Session metadata（创建 checkout 时传入的自定义数据）
 */
export interface CheckoutMetadata {
  userId: string;
  orgId: string;
  planKey: string;
  moduleKeys?: string; // JSON 字符串，如 '["analytics", "export"]'
}

/**
 * Webhook 处理结果
 */
export interface WebhookProcessResult {
  success: boolean;
  eventId: string;
  eventType: string;
  message: string;
}

/**
 * 支持的 Stripe 事件类型
 */
export type SupportedStripeEvent =
  | 'checkout.session.completed'
  | 'customer.subscription.created'
  | 'customer.subscription.updated'
  | 'customer.subscription.deleted'
  | 'invoice.payment_succeeded'
  | 'invoice.payment_failed';

/**
 * 检查是否为支持的事件类型
 */
export function isSupportedEvent(eventType: string): eventType is SupportedStripeEvent {
  const supportedEvents: string[] = [
    'checkout.session.completed',
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.payment_succeeded',
    'invoice.payment_failed',
  ];
  return supportedEvents.includes(eventType);
}
