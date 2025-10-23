import { z } from 'zod';

/**
 * 资源管理API的参数校验Schema
 */

// 资源类型枚举
export const ResourceTypeSchema = z.enum(['pos', 'kiosk', 'tablet', 'manager', 'staff'], {
  errorMap: () => ({ message: 'Resource type must be one of: pos, kiosk, tablet, manager, staff' }),
});

// 资源分类枚举
export const ResourceCategorySchema = z.enum(['device', 'account'], {
  errorMap: () => ({ message: 'Resource category must be one of: device, account' }),
});

// 资源状态枚举
export const ResourceStatusSchema = z.enum(['ACTIVE', 'DEPRECATED'], {
  errorMap: () => ({ message: 'Resource status must be one of: ACTIVE, DEPRECATED' }),
});

// 创建资源的请求体
export const CreateResourceSchema = z.object({
  type: ResourceTypeSchema,

  category: ResourceCategorySchema,

  name: z
    .string({
      required_error: 'Resource name (name) is required',
    })
    .min(1, 'Resource name must be at least 1 character')
    .max(100, 'Resource name must be at most 100 characters'),

  monthlyPrice: z
    .number({
      required_error: 'Monthly price (monthlyPrice) is required',
      invalid_type_error: 'Monthly price must be a number',
    })
    .nonnegative('Monthly price must be greater than or equal to 0')
    .multipleOf(0.01, 'Monthly price must have at most 2 decimal places'),

  standardQuota: z
    .number({
      required_error: 'Standard Plan quota (standardQuota) is required',
      invalid_type_error: 'Standard Plan quota must be a number',
    })
    .int('Standard Plan quota must be an integer')
    .nonnegative('Standard Plan quota must be greater than or equal to 0'),

  status: ResourceStatusSchema.optional().default('ACTIVE'),
});

// 更新资源的请求体
export const UpdateResourceSchema = z
  .object({
    category: ResourceCategorySchema.optional(),

    name: z.string().min(1, 'Resource name must be at least 1 character').max(100, 'Resource name must be at most 100 characters').optional(),

    monthlyPrice: z
      .number({
        invalid_type_error: 'Monthly price must be a number',
      })
      .nonnegative('Monthly price must be greater than or equal to 0')
      .multipleOf(0.01, 'Monthly price must have at most 2 decimal places')
      .optional(),

    standardQuota: z
      .number({
        invalid_type_error: 'Standard Plan quota must be a number',
      })
      .int('Standard Plan quota must be an integer')
      .nonnegative('Standard Plan quota must be greater than or equal to 0')
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field to update is required',
  });

// 更新资源状态的请求体
export const UpdateResourceStatusSchema = z.object({
  status: ResourceStatusSchema,
});

// 列出资源的查询参数
export const ListResourcesQuerySchema = z.object({
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

  category: ResourceCategorySchema.optional(),

  status: ResourceStatusSchema.optional(),

  sortBy: z.enum(['createdAt', 'monthlyPrice', 'name']).optional().default('createdAt'),

  order: z.enum(['asc', 'desc']).optional().default('desc'),
});

// UUID参数验证
export const UuidParamSchema = z.object({
  id: z.string().uuid('Resource ID must be a valid UUID format'),
});

// TypeScript类型导出
export type CreateResourceInput = z.infer<typeof CreateResourceSchema>;
export type UpdateResourceInput = z.infer<typeof UpdateResourceSchema>;
export type UpdateResourceStatusInput = z.infer<typeof UpdateResourceStatusSchema>;
export type ListResourcesQuery = z.infer<typeof ListResourcesQuerySchema>;
export type UuidParam = z.infer<typeof UuidParamSchema>;
