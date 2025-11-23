/**
 * 查询API相关的类型定义
 */

/**
 * 订阅信息
 */
export interface SubscriptionInfo {
  status: string;
  planKey: string | null;
  planName: string | null;
  moduleKeys: string[];
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
}

/**
 * 权限信息
 */
export interface PermissionsInfo {
  features: string[];
  includedModules: string[];
}

/**
 * Trial 信息
 */
export interface TrialInfo {
  hasUsedTrial: boolean;
  canStartTrial: boolean;
  trialActivatedAt: string | null;
}

/**
 * 组织订阅详情（完整响应）
 */
export interface OrgSubscriptionDetails {
  subscription: SubscriptionInfo;
  permissions: PermissionsInfo;
  trial: TrialInfo;
}
