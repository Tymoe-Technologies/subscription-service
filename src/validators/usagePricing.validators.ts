import { z } from 'zod';

/**
 * 按量计费管理API的参数校验Schema
 */

// 货币枚举（目前固定CAD，预留扩展）
export const CurrencySchema = z.enum(['CAD'], {
  errorMap: () => ({ message: 'Currency type must be CAD' }),
});

// 创建按量计费规则的请求体
export const CreateUsagePricingSchema = z.object({
  usageType: z
    .string({
      required_error: 'Usage type (usageType) is required',
    })
    .min(3, 'Usage type must be at least 3 characters')
    .max(50, 'Usage type must be at most 50 characters')
    .regex(
      /^[a-z][a-z0-9_]*$/,
      'Usage type can only contain lowercase letters, numbers and underscores, and must start with a letter'
    ),

  displayName: z
    .string({
      required_error: 'Display name (displayName) is required',
    })
    .min(1, 'Display name must be at least 1 character')
    .max(100, 'Display name must be at most 100 characters'),

  unitPrice: z
    .number({
      required_error: 'Unit price (unitPrice) is required',
      invalid_type_error: 'Unit price must be a number',
    })
    .nonnegative('Unit price must be greater than or equal to 0')
    .multipleOf(0.0001, 'Unit price must have at most 4 decimal places'),

  currency: CurrencySchema.optional().default('CAD'),

  isActive: z.boolean().optional().default(true),
});

// 更新按量计费规则的请求体
export const UpdateUsagePricingSchema = z
  .object({
    displayName: z
      .string()
      .min(1, 'Display name must be at least 1 character')
      .max(100, 'Display name must be at most 100 characters')
      .optional(),

    unitPrice: z
      .number({
        invalid_type_error: 'Unit price must be a number',
      })
      .nonnegative('Unit price must be greater than or equal to 0')
      .multipleOf(0.0001, 'Unit price must have at most 4 decimal places')
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field to update is required',
  });

// 更新按量计费规则状态的请求体
export const UpdateUsagePricingStatusSchema = z.object({
  isActive: z.boolean({
    required_error: 'Active status (isActive) is required',
    invalid_type_error: 'Active status must be a boolean',
  }),
});

// 列出按量计费规则的查询参数
export const ListUsagePricingQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 1))
    .pipe(z.number().int().min(1, 'Page must be greater than or equal to 1')),

  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 20))
    .pipe(z.number().int().min(1, 'Limit must be greater than or equal to 1').max(100, 'Limit must be less than or equal to 100')),

  isActive: z
    .string()
    .optional()
    .transform((val) => {
      if (val === undefined || val === '') return undefined;
      if (val === 'true') return true;
      if (val === 'false') return false;
      throw new Error('isActive must be true or false');
    })
    .pipe(z.boolean().optional()),

  sortBy: z.enum(['createdAt', 'unitPrice', 'displayName']).optional().default('createdAt'),

  order: z.enum(['asc', 'desc']).optional().default('desc'),
});

// UUID参数验证
export const UuidParamSchema = z.object({
  id: z.string().uuid('Usage pricing ID must be a valid UUID format'),
});

// TypeScript类型导出
export type CreateUsagePricingInput = z.infer<typeof CreateUsagePricingSchema>;
export type UpdateUsagePricingInput = z.infer<typeof UpdateUsagePricingSchema>;
export type UpdateUsagePricingStatusInput = z.infer<typeof UpdateUsagePricingStatusSchema>;
export type ListUsagePricingQuery = z.infer<typeof ListUsagePricingQuerySchema>;
export type UuidParam = z.infer<typeof UuidParamSchema>;
