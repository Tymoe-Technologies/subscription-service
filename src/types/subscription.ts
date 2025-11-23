// ========================================
// 订阅相关类型定义
// ========================================

// ===== 请求相关类型 =====

/**
 * 创建 Checkout Session 请求体
 */
export interface CreateCheckoutRequestBody {
  orgId: string;
  planKey: string;
  moduleKeys?: string[];
}

// ===== Service 层参数类型 =====

/**
 * 创建 Checkout Session 的 Service 层参数
 */
export interface CreateCheckoutParams {
  userId: string;      // 来自 JWT
  orgId: string;
  planKey: string;
  moduleKeys: string[];
}

// ===== Service 层返回类型 =====

/**
 * Checkout Session 创建结果
 */
export interface CheckoutSessionResult {
  checkoutUrl: string;
  sessionId: string;
  expiresAt: Date;
}

/**
 * 订阅详情
 */
export interface SubscriptionDetails {
  orgId: string;
  status: string;
  items: SubscriptionItem[];
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 订阅项（Plan 或 Module）
 */
export interface SubscriptionItem {
  priceId: string;
  moduleKey: string;
  quantity: number;
}

/**
 * Billing Portal 创建结果
 */
export interface BillingPortalResult {
  portalUrl: string;
}

// ===== Stripe 相关类型 =====

/**
 * Stripe Checkout Line Item
 */
export interface StripeLineItem {
  price: string;        // stripePriceId
  quantity: number;
}

/**
 * Stripe Checkout Session 元数据
 */
export interface StripeCheckoutMetadata {
  orgId: string;
  userId: string;
  planKey: string;
  moduleKeys: string;  // JSON 字符串
}

/**
 * Stripe Subscription 元数据
 */
export interface StripeSubscriptionMetadata {
  orgId: string;
  planKey: string;
}