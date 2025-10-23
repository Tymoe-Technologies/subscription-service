import { z } from 'zod';

/**
 * 模块管理API的参数校验Schema
 */

// 模块分类枚举
export const ModuleCategorySchema = z.enum(['core', 'business', 'marketing', 'analytics'], {
  errorMap: () => ({ message: 'Module category must be one of: core, business, marketing, analytics' }),
});

// 定价模型枚举
export const PricingModelSchema = z.enum(['fixed', 'per_usage', 'hybrid'], {
  errorMap: () => ({ message: 'Pricing model must be one of: fixed, per_usage, hybrid' }),
});

// 模块状态枚举
export const ModuleStatusSchema = z.enum(['ACTIVE', 'DEPRECATED', 'SUSPENDED', 'COMING_SOON'], {
  errorMap: () => ({ message: 'Module status must be one of: ACTIVE, DEPRECATED, SUSPENDED, COMING_SOON' }),
});

// 创建模块的请求体
export const CreateModuleSchema = z.object({
  key: z
    .string({
      required_error: 'Module key (key) is required',
    })
    .min(3, 'Module key must be at least 3 characters')
    .max(50, 'Module key must be at most 50 characters')
    .regex(
      /^[a-z][a-z0-9_]*$/,
      'Module key can only contain lowercase letters, numbers and underscores, and must start with a letter'
    ),

  name: z
    .string({
      required_error: 'Module name (name) is required',
    })
    .min(1, 'Module name must be at least 1 character')
    .max(100, 'Module name must be at most 100 characters'),

  description: z.string().max(1000, 'Description must be at most 1000 characters').optional(),

  category: ModuleCategorySchema,

  monthlyPrice: z
    .number({
      required_error: 'Monthly price (monthlyPrice) is required',
      invalid_type_error: 'Monthly price must be a number',
    })
    .nonnegative('Monthly price must be greater than or equal to 0')
    .multipleOf(0.01, 'Monthly price must have at most 2 decimal places'),

  pricingModel: PricingModelSchema,

  dependencies: z
    .array(z.string(), {
      invalid_type_error: 'Dependencies must be a string array',
    })
    .optional()
    .default([]),

  status: ModuleStatusSchema.optional().default('ACTIVE'),
});

// 更新模块的请求体
export const UpdateModuleSchema = z
  .object({
    name: z.string().min(1, 'Module name must be at least 1 character').max(100, 'Module name must be at most 100 characters').optional(),

    description: z.string().max(1000, 'Description must be at most 1000 characters').optional(),

    category: ModuleCategorySchema.optional(),

    monthlyPrice: z
      .number({
        invalid_type_error: 'Monthly price must be a number',
      })
      .nonnegative('Monthly price must be greater than or equal to 0')
      .multipleOf(0.01, 'Monthly price must have at most 2 decimal places')
      .optional(),

    pricingModel: PricingModelSchema.optional(),

    dependencies: z
      .array(z.string(), {
        invalid_type_error: 'Dependencies must be a string array',
      })
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field to update is required',
  });

// 更新模块状态的请求体
export const UpdateModuleStatusSchema = z.object({
  status: ModuleStatusSchema,
});

// 列出模块的查询参数
export const ListModulesQuerySchema = z.object({
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

  category: ModuleCategorySchema.optional(),

  status: ModuleStatusSchema.optional(),

  sortBy: z.enum(['createdAt', 'monthlyPrice', 'name']).optional().default('createdAt'),

  order: z.enum(['asc', 'desc']).optional().default('desc'),
});

// UUID参数验证
export const UuidParamSchema = z.object({
  id: z.string().uuid('Module ID must be a valid UUID format'),
});

// TypeScript类型导出
export type CreateModuleInput = z.infer<typeof CreateModuleSchema>;
export type UpdateModuleInput = z.infer<typeof UpdateModuleSchema>;
export type UpdateModuleStatusInput = z.infer<typeof UpdateModuleStatusSchema>;
export type ListModulesQuery = z.infer<typeof ListModulesQuerySchema>;
export type UuidParam = z.infer<typeof UuidParamSchema>;
