import { Request } from 'express';

// JWT Payload 类型定义
export interface JWTPayload {
  sub: string; // userId or accountId
  userType: 'USER' | 'ACCOUNT'; // USER类型才能订阅
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string;
  email?: string;
  roles?: string[];
  scopes?: string[];
  organizationId?: string;
  organizations?: Array<{
    id: string; // organizationId
    name: string;
    orgName?: string;
    orgType?: 'MAIN' | 'BRANCH' | 'FRANCHISE'; // 店铺类型
    parentOrgId?: string; // 父店铺ID (BRANCH/FRANCHISE用)
    role?: string;
    status?: string;
  }>;
  // ACCOUNT类型特有字段
  accountType?: 'MANAGER' | 'STAFF';
  username?: string;
  employeeNumber?: string;
  [key: string]: any;
}

// AuthenticatedRequest interface for middleware
export interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    userId?: string;          // 兼容旧代码，与 id 同义
    email: string;
    iat: number;
    exp: number;
    organizationId?: string;
    organizationIds?: string[]; // 用户所属的所有组织ID列表
    organizationName?: string;
    userType?: 'USER' | 'ACCOUNT';
    accountType?: 'MANAGER' | 'STAFF';
    jti?: string;             // JWT ID (用于黑名单检查)
    organizations?: Array<{
      id: string;
      name: string;
      orgName?: string;
      orgType?: 'MAIN' | 'BRANCH' | 'FRANCHISE';
      parentOrgId?: string;
      role?: string;
      status?: string;
    }>;
  };
}

// SubscriptionIntent相关类型
export interface CreateIntentRequest {
  organizationId: string;
  productKey: string;
  action: string;
  stripePriceId?: string;
  metadata?: Record<string, any>;
}

export interface IntentResponse {
  id: string;
  status: string;
  checkoutUrl?: string;
  expiresAt: Date;
}

// Trial相关类型
export interface StartTrialRequest {
  productKey: string;
}

export interface TrialSubscription {
  id: string;
  organizationId: string;
  productKey: string;
  status: string;
  startDate: Date;
  endDate: Date;
}

// Webhook事件类型
export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: {
    object: any;
  };
}

// API响应类型
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

// 订阅详情类型
export interface SubscriptionDetails {
  id: string;
  organizationId: string;
  productKey: string;
  status: string;
  startDate: Date;
  endDate?: Date;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  stripeSubscriptionId?: string;
  cancelAtPeriodEnd: boolean;
}

// ========================================
// Part 2: 订阅管理API 类型定义
// ========================================

// 取消订阅原因枚举
export enum CancelReason {
  TOO_EXPENSIVE = 'TOO_EXPENSIVE',
  MISSING_FEATURES = 'MISSING_FEATURES',
  SWITCHING_COMPETITOR = 'SWITCHING_COMPETITOR',
  BUSINESS_CLOSED = 'BUSINESS_CLOSED',
  TECHNICAL_ISSUES = 'TECHNICAL_ISSUES',
  POOR_SUPPORT = 'POOR_SUPPORT',
  NOT_USING = 'NOT_USING',
  OTHER = 'OTHER',
}

// 取消原因显示文本映射
export const CancelReasonDisplay: Record<CancelReason, string> = {
  [CancelReason.TOO_EXPENSIVE]: 'Too expensive',
  [CancelReason.MISSING_FEATURES]: 'Missing features',
  [CancelReason.SWITCHING_COMPETITOR]: 'Switching to competitor',
  [CancelReason.BUSINESS_CLOSED]: 'Business closed',
  [CancelReason.TECHNICAL_ISSUES]: 'Technical issues',
  [CancelReason.POOR_SUPPORT]: 'Poor customer support',
  [CancelReason.NOT_USING]: 'Not using the service',
  [CancelReason.OTHER]: 'Other reason',
};

// 激活类型
export type ActivationType = 'from_trial' | 'skip_trial';

// 资源类型
export type ResourceType = 'pos' | 'kiosk' | 'tablet' | 'manager' | 'staff';

// ========================================
// Trial相关类型定义
// ========================================

// 创建Trial订阅请求
export interface CreateTrialSubscriptionRequest {
  organizationIds: string[]; // 要创建Trial的主店铺ID数组
}

// 创建Trial订阅响应
export interface CreateTrialSubscriptionResponse {
  subscriptions: Array<{
    id: string;
    organizationId: string;
    status: string;
    startedAt: Date;
    trialEndsAt: Date;
  }>;
  userTrialStatus: {
    userId: string;
    hasUsedTrial: boolean;
    trialActivatedAt: Date;
  };
}

// 激活订阅请求 (更新版本)
export interface ActivateSubscriptionRequest {
  organizationId: string; // 要激活的店铺ID
  paymentMethodId: string; // 支付方式ID
  activationType: ActivationType; // 激活类型
}

// Trial错误相关
export enum TrialErrorCode {
  TRIAL_ALREADY_USED = 'TRIAL_ALREADY_USED', // 用户已使用过Trial
  ORGANIZATION_NOT_FOUND = 'ORGANIZATION_NOT_FOUND', // organizationId不属于该用户
  SUBSCRIPTION_ALREADY_EXISTS = 'SUBSCRIPTION_ALREADY_EXISTS', // 店铺已存在订阅
  PARENT_STORE_IN_TRIAL = 'PARENT_STORE_IN_TRIAL', // 父店铺在Trial状态，无法为子店铺订阅，需先激活父店
  PARENT_STORE_NOT_ACTIVE = 'PARENT_STORE_NOT_ACTIVE', // 父店铺不是Active状态
}

// 父店铺Trial限制错误详情
export interface ParentStoreTrialErrorDetails {
  parentStoreId: string; // 父店铺ID
  parentStoreName: string; // 父店铺名称
  parentStoreStatus: 'TRIAL'; // 父店状态
  trialEndsAt: Date; // Trial结束时间
  suggestedAction: 'ACTIVATE_PARENT_SUBSCRIPTION'; // 建议操作
  childStoreType: string; // 子店铺类型(BRANCH或FRANCHISE)
}