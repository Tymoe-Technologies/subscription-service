// 订阅状态常量 - 对应Prisma SubscriptionStatus枚举
export const SUBSCRIPTION_STATUS = {
  TRIALING: 'TRIALING',
  ACTIVE: 'ACTIVE',
  PAST_DUE: 'PAST_DUE',
  CANCELED: 'CANCELED',
  EXPIRED: 'EXPIRED'
} as const;

// 订阅Intent状态
export const SUBSCRIPTION_INTENT_STATUS = {
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED'
} as const;

// 订阅Intent动作
export const SUBSCRIPTION_INTENT_ACTION = {
  CHECKOUT: 'CHECKOUT',
  UPGRADE: 'UPGRADE',
  CANCEL: 'CANCEL',
  REACTIVATE: 'REACTIVATE',
  START_TRIAL: 'START_TRIAL'
} as const;

// 产品Key常量 - 按要求使用string类型
export const PRODUCT_KEYS = {
  PLOML_TRIAL: 'ploml-trial',
  PLOML_BASIC: 'ploml-basic',
  PLOML_PRO: 'ploml-pro',
  MOPAI_TRIAL: 'mopai-trial',
  MOPAI_BASIC: 'mopai-basic',
  MOPAI_PRO: 'mopai-pro'
} as const;

// 审计日志实体类型
export const AUDIT_ENTITY_TYPE = {
  SUBSCRIPTION: 'SUBSCRIPTION',
  ORGANIZATION: 'ORGANIZATION',
  TRIAL: 'TRIAL'
} as const;

// 审计日志动作
export const AUDIT_ACTION = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  CANCEL: 'CANCEL',
  REACTIVATE: 'REACTIVATE'
} as const;

// 审计日志操作者类型
export const AUDIT_ACTOR_TYPE = {
  USER: 'USER',
  ADMIN: 'ADMIN',
  WEBHOOK: 'WEBHOOK',
  SYSTEM: 'SYSTEM'
} as const;

// 检查是否是试用产品
export function isTrialProduct(productKey: string): boolean {
  return productKey.endsWith('-trial');
}