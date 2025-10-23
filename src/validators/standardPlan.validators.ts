import { z } from 'zod';

/**
 * Standard Plan管理API的参数校验Schema
 */

// Standard Plan状态枚举
export const StandardPlanStatusSchema = z.enum(['PENDING', 'ACTIVE', 'ARCHIVED', 'DELETED'], {
  errorMap: () => ({ message: 'Status must be one of: PENDING, ACTIVE, ARCHIVED, DELETED' }),
});

// 资源配额Schema
export const ResourceQuotasSchema = z.object({
  pos: z.number().int().nonnegative('POS quota must be >= 0'),
  kiosk: z.number().int().nonnegative('Kiosk quota must be >= 0'),
  tablet: z.number().int().nonnegative('Tablet quota must be >= 0'),
  manager: z.number().int().nonnegative('Manager quota must be >= 0'),
  staff: z.number().int().nonnegative('Staff quota must be >= 0'),
});

// 创建Standard Plan的请求体
export const CreateStandardPlanSchema = z.object({
  name: z
    .string({
      required_error: 'Name (name) is required',
    })
    .min(1, 'Name must be at least 1 character')
    .max(100, 'Name must be at most 100 characters'),

  version: z
    .string({
      required_error: 'Version (version) is required',
    })
    .min(1, 'Version must be at least 1 character')
    .max(50, 'Version must be at most 50 characters'),

  description: z.string().max(1000, 'Description must be at most 1000 characters').optional(),

  monthlyPrice: z
    .number({
      required_error: 'Monthly price (monthlyPrice) is required',
      invalid_type_error: 'Monthly price must be a number',
    })
    .nonnegative('Monthly price must be >= 0')
    .multipleOf(0.01, 'Monthly price must have at most 2 decimal places'),

  includedModuleKeys: z
    .array(z.string())
    .default([]),

  resourceQuotas: ResourceQuotasSchema,

  trialDurationDays: z
    .number({
      required_error: 'Trial duration days (trialDurationDays) is required',
      invalid_type_error: 'Trial duration days must be a number',
    })
    .int('Trial duration days must be an integer')
    .nonnegative('Trial duration days must be >= 0'),

  trialSmsQuota: z
    .number({
      required_error: 'Trial SMS quota (trialSmsQuota) is required',
      invalid_type_error: 'Trial SMS quota must be a number',
    })
    .int('Trial SMS quota must be an integer')
    .nonnegative('Trial SMS quota must be >= 0'),
});

// 更新Standard Plan的请求体
export const UpdateStandardPlanSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Name must be at least 1 character')
      .max(100, 'Name must be at most 100 characters')
      .optional(),

    version: z
      .string()
      .min(1, 'Version must be at least 1 character')
      .max(50, 'Version must be at most 50 characters')
      .optional(),

    description: z.string().max(1000, 'Description must be at most 1000 characters').optional(),

    monthlyPrice: z
      .number({
        invalid_type_error: '月费价格必须是数字',
      })
      .nonnegative('月费价格必须>=0')
      .multipleOf(0.01, '月费价格最多2位小数')
      .optional(),

    includedModuleKeys: z.array(z.string()).optional(),

    resourceQuotas: ResourceQuotasSchema.optional(),

    trialDurationDays: z
      .number({
        invalid_type_error: '试用期天数必须是数字',
      })
      .int('试用期天数必须是整数')
      .nonnegative('试用期天数必须>=0')
      .optional(),

    trialSmsQuota: z
      .number({
        invalid_type_error: '试用期短信配额必须是数字',
      })
      .int('试用期短信配额必须是整数')
      .nonnegative('试用期短信配额必须>=0')
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field to update is required',
  });

// 列出Standard Plan的查询参数
export const ListStandardPlanQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 1))
    .pipe(z.number().int().min(1, 'Page must be >= 1')),

  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 20))
    .pipe(z.number().int().min(1, 'Limit must be >= 1').max(50, 'Limit must be <= 50')),

  status: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      if (!['PENDING', 'ACTIVE', 'ARCHIVED', 'DELETED'].includes(val)) {
        throw new Error('status must be one of: PENDING, ACTIVE, ARCHIVED, DELETED');
      }
      return val as 'PENDING' | 'ACTIVE' | 'ARCHIVED' | 'DELETED';
    })
    .pipe(StandardPlanStatusSchema.optional()),

  includeDeleted: z
    .string()
    .optional()
    .transform((val) => {
      if (val === undefined || val === '') return false;
      if (val === 'true') return true;
      if (val === 'false') return false;
      throw new Error('includeDeleted must be true or false');
    })
    .pipe(z.boolean()),

  sortBy: z
    .enum(['createdAt', 'activatedAt', 'monthlyPrice'])
    .optional()
    .default('createdAt'),

  order: z.enum(['asc', 'desc']).optional().default('desc'),
});

// UUID参数验证
export const UuidParamSchema = z.object({
  id: z.string().uuid('Standard Plan ID must be a valid UUID format'),
});

// TypeScript类型导出
export type CreateStandardPlanInput = z.infer<typeof CreateStandardPlanSchema>;
export type UpdateStandardPlanInput = z.infer<typeof UpdateStandardPlanSchema>;
export type ListStandardPlanQuery = z.infer<typeof ListStandardPlanQuerySchema>;
export type UuidParam = z.infer<typeof UuidParamSchema>;
export type ResourceQuotas = z.infer<typeof ResourceQuotasSchema>;
