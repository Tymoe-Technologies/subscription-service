import { z } from 'zod';

/**
 * Part 4: 内部API - Zod验证Schemas
 * 用于验证微服务间调用的请求参数
 */

// ========================================
// 资源类型枚举
// ========================================

export const ResourceTypeSchema = z.enum(['pos', 'kiosk', 'tablet', 'manager', 'staff']);
export const ResourceCategorySchema = z.enum(['device', 'account']);
export const SuspendReasonSchema = z.enum(['DOWNGRADE', 'PAYMENT_FAILED', 'MANUAL']);
export const UsageTypeSchema = z.enum(['sms', 'api_call']);

// ========================================
// API 1: 检查资源配额
// ========================================

export const CheckQuotaSchema = z.object({
  orgId: z.string().min(1, 'Organization ID is required'),
  resourceType: ResourceTypeSchema,
  quantity: z.number().int().positive().default(1).optional(),
});

export type CheckQuotaRequest = z.infer<typeof CheckQuotaSchema>;

// ========================================
// API 2: 检查访问权限
// ========================================

export const CheckAccessSchema = z.object({
  orgId: z.string().min(1, 'Organization ID is required'),
  resourceType: ResourceCategorySchema,
  resourceSubtype: ResourceTypeSchema,
  resourceId: z.string().min(1, 'Resource ID is required'),
});

export type CheckAccessRequest = z.infer<typeof CheckAccessSchema>;

// ========================================
// API 3: 暂停资源
// ========================================

export const SuspendResourceSchema = z.object({
  orgId: z.string().min(1, 'Organization ID is required'),
  resourceType: ResourceCategorySchema,
  resourceSubtype: ResourceTypeSchema,
  resourceId: z.string().min(1, 'Resource ID is required'),
  reason: SuspendReasonSchema,
  gracePeriodDays: z.number().int().positive().default(30).optional(),
});

export type SuspendResourceRequest = z.infer<typeof SuspendResourceSchema>;

// ========================================
// API 4: 恢复资源
// ========================================

export const RestoreResourceSchema = z.object({
  orgId: z.string().min(1, 'Organization ID is required'),
  resourceType: ResourceCategorySchema,
  resourceSubtype: ResourceTypeSchema,
  resourceId: z.string().min(1, 'Resource ID is required'),
});

export type RestoreResourceRequest = z.infer<typeof RestoreResourceSchema>;

// ========================================
// API 5: 记录使用量
// ========================================

export const RecordUsageSchema = z.object({
  orgId: z.string().min(1, 'Organization ID is required'),
  usageType: UsageTypeSchema,
  quantity: z.number().int().positive(),
  metadata: z.record(z.any()).optional(),
  moduleKey: z.string().optional(),
  providerRecordId: z.string().optional(), // 用于幂等性
});

export type RecordUsageRequest = z.infer<typeof RecordUsageSchema>;

// ========================================
// API 6: 批量记录使用量
// ========================================

export const BatchRecordUsageSchema = z.object({
  orgId: z.string().min(1, 'Organization ID is required'),
  records: z.array(
    z.object({
      usageType: UsageTypeSchema,
      quantity: z.number().int().positive(),
      metadata: z.record(z.any()).optional(),
      moduleKey: z.string().optional(),
      providerRecordId: z.string().optional(),
    })
  ).min(1, 'At least one record is required'),
});

export type BatchRecordUsageRequest = z.infer<typeof BatchRecordUsageSchema>;

// ========================================
// API 7: 统计活跃资源
// ========================================

export const StatsActiveResourcesSchema = z.object({
  orgId: z.string().min(1, 'Organization ID is required'),
  resources: z.object({
    pos: z.number().int().nonnegative(),
    kiosk: z.number().int().nonnegative(),
    tablet: z.number().int().nonnegative(),
    manager: z.number().int().nonnegative(),
    staff: z.number().int().nonnegative(),
  }),
});

export type StatsActiveResourcesRequest = z.infer<typeof StatsActiveResourcesSchema>;
