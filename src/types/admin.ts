import { PlanStatus, ModuleStatus } from '@prisma/client';

// ========================================
// Plan 相关类型定义
// ========================================

/**
 * Plan 包含的模块（带数量）
 */
export interface IncludedModule {
  moduleKey: string;
  quantity: number; // allowMultiple=false 的模块始终为 1
}

/**
 * 创建 Plan 请求参数
 */
export interface CreatePlanParams {
  key: string;
  name: string;
  version: string;
  description?: string;
  monthlyPrice: number; // Decimal in dollars
  includedModules?: IncludedModule[];
  trialDurationDays: number;
  status?: PlanStatus; // 创建时指定状态（默认 ACTIVE）
  syncToStripe?: boolean; // 是否同步到 Stripe (默认 true)
}

/**
 * 更新 Plan 请求参数
 */
export interface UpdatePlanParams {
  name?: string;
  version?: string;
  description?: string;
  monthlyPrice?: number; // 如果修改价格，会自动同步到 Stripe
  status?: PlanStatus;
  trialDurationDays?: number;
  includedModules?: IncludedModule[];
}

/**
 * 同步 Plan 到 Stripe 请求参数
 */
export interface SyncPlanToStripeParams {
  monthlyPrice: number; // 新的月价格 (dollars)
}

/**
 * Plan 查询参数
 */
export interface PlanQueryParams {
  status?: PlanStatus;
  limit?: number;
  offset?: number;
}

/**
 * Plan 详情响应数据
 */
export interface PlanDetails {
  id: string;
  key: string;
  name: string;
  version: string;
  description: string | null;
  monthlyPrice: string; // Decimal as string
  includedModules: IncludedModule[];
  trialDurationDays: number;
  status: PlanStatus;
  stripePriceId: string | null;
  stripeProductId: string | null;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/**
 * Plan 列表响应数据
 */
export interface PlanListResponse {
  plans: PlanDetails[];
  total: number;
  limit: number;
  offset: number;
}

// ========================================
// Module 相关类型定义
// ========================================

/**
 * 创建 Module 请求参数
 */
export interface CreateModuleParams {
  key: string;
  name: string;
  version: string;
  description?: string;
  monthlyPrice: number; // Decimal in dollars
  dependencies?: string[]; // Module keys
  allowMultiple?: boolean; // 是否允许购买多个（默认 false）
  status?: ModuleStatus; // 创建时指定状态（默认 ACTIVE）
  syncToStripe?: boolean; // 是否同步到 Stripe (默认 true)
}

/**
 * 更新 Module 请求参数
 */
export interface UpdateModuleParams {
  name?: string;
  version?: string;
  description?: string;
  monthlyPrice?: number; // 如果修改价格，会自动同步到 Stripe
  status?: ModuleStatus;
  dependencies?: string[];
  allowMultiple?: boolean; // 是否允许购买多个
}

/**
 * 同步 Module 到 Stripe 请求参数
 */
export interface SyncModuleToStripeParams {
  monthlyPrice: number; // 新的月价格 (dollars)
}

/**
 * Module 查询参数
 */
export interface ModuleQueryParams {
  status?: ModuleStatus;
  limit?: number;
  offset?: number;
}

/**
 * Module 详情响应数据
 */
export interface ModuleDetails {
  id: string;
  key: string;
  name: string;
  version: string;
  description: string | null;
  monthlyPrice: string; // Decimal as string
  dependencies: string[];
  allowMultiple: boolean; // 是否允许购买多个
  status: ModuleStatus;
  stripePriceId: string | null;
  stripeProductId: string | null;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/**
 * Module 列表响应数据
 */
export interface ModuleListResponse {
  modules: ModuleDetails[];
  total: number;
  limit: number;
  offset: number;
}

// ========================================
// 通用响应类型
// ========================================

/**
 * 成功响应包装器
 */
export interface SuccessResponse<T> {
  success: true;
  message: string;
  data: T;
}

/**
 * 错误响应包装器
 */
export interface ErrorResponse {
  success: false;
  error: string;
  detail?: string;
}

/**
 * API 响应类型
 */
export type ApiResponse<T> = SuccessResponse<T> | ErrorResponse;
