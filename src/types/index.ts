import { Request } from 'express';

// JWT Payload 类型定义
export interface JWTPayload {
  sub: string; // userId
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
  }>;
  [key: string]: any;
}

// AuthenticatedRequest interface for middleware
export interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    email: string;
    iat: number;
    exp: number;
    organizationId?: string | undefined;
    organizationName?: string | undefined;
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