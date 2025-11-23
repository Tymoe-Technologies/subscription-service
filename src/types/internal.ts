/**
 * 内部 API 相关的类型定义
 */

/**
 * 模块配额信息
 */
export interface ModuleQuota {
  moduleKey: string;
  purchasedCount: number;
  allowMultiple: boolean;
  source: 'plan_included' | 'addon';
}

/**
 * 组织模块配额响应
 */
export interface OrgModuleQuotasResponse {
  orgId: string;
  subscriptionStatus: string;
  planKey: string | null;
  quotas: ModuleQuota[];
}
