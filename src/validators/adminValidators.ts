import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { PlanStatus, ModuleStatus } from '@prisma/client';
import { AppError } from '../utils/errors.js';

// ========================================
// Plan 验证 Schemas
// ========================================

/**
 * Plan 包含的模块（带数量）验证
 */
const includedModuleSchema = z.object({
  moduleKey: z.string().min(1).max(100),
  quantity: z.number().int().min(1),
});

/**
 * 创建 Plan 请求体验证
 */
const createPlanSchema = z.object({
  key: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  version: z.string().min(1).max(255),
  description: z.string().optional(),
  monthlyPrice: z.number().positive(),
  includedModules: z.array(includedModuleSchema).optional().default([]),
  trialDurationDays: z.number().int().min(0),
  status: z.nativeEnum(PlanStatus).optional().default(PlanStatus.ACTIVE),
  syncToStripe: z.boolean().optional().default(true),
});

/**
 * 更新 Plan 请求体验证
 */
const updatePlanSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    version: z.string().min(1).max(255).optional(),
    description: z.string().optional(),
    monthlyPrice: z.number().positive().optional(),
    status: z.nativeEnum(PlanStatus).optional(),
    trialDurationDays: z.number().int().min(0).optional(),
    includedModules: z.array(includedModuleSchema).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  });

/**
 * 同步 Plan 到 Stripe 请求体验证
 */
const syncPlanToStripeSchema = z.object({
  monthlyPrice: z.number().positive(),
});

/**
 * Plan 查询参数验证
 */
const planQuerySchema = z.object({
  status: z.nativeEnum(PlanStatus).optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).optional(),
  offset: z.string().regex(/^\d+$/).transform(Number).optional(),
});

// ========================================
// Module 验证 Schemas
// ========================================

/**
 * 创建 Module 请求体验证
 */
const createModuleSchema = z.object({
  key: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  version: z.string().min(1).max(255),
  description: z.string().optional(),
  monthlyPrice: z.number().positive(),
  dependencies: z.array(z.string().min(1).max(100)).optional().default([]),
  allowMultiple: z.boolean().optional().default(false),
  status: z.nativeEnum(ModuleStatus).optional().default(ModuleStatus.ACTIVE),
  syncToStripe: z.boolean().optional().default(true),
});

/**
 * 更新 Module 请求体验证
 */
const updateModuleSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    version: z.string().min(1).max(255).optional(),
    description: z.string().optional(),
    monthlyPrice: z.number().positive().optional(),
    status: z.nativeEnum(ModuleStatus).optional(),
    dependencies: z.array(z.string().min(1).max(100)).optional(),
    allowMultiple: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  });

/**
 * 同步 Module 到 Stripe 请求体验证
 */
const syncModuleToStripeSchema = z.object({
  monthlyPrice: z.number().positive(),
});

/**
 * Module 查询参数验证
 */
const moduleQuerySchema = z.object({
  status: z.nativeEnum(ModuleStatus).optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).optional(),
  offset: z.string().regex(/^\d+$/).transform(Number).optional(),
});

// ========================================
// 通用验证 Schemas
// ========================================

/**
 * UUID 路径参数验证
 */
const uuidParamSchema = z.object({
  id: z.string().uuid('Invalid UUID format'),
});

// ========================================
// 验证中间件函数
// ========================================

/**
 * 通用验证中间件工厂函数
 */
function createValidator(schema: z.ZodSchema, source: 'body' | 'params' | 'query') {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const validated = schema.parse(req[source]);
      req[source] = validated;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const firstError = error.errors[0];
        if (firstError) {
          next(
            new AppError(
              'validation_error',
              `${firstError.path.join('.')}: ${firstError.message}`,
              400
            )
          );
        } else {
          next(new AppError('validation_error', 'Validation failed', 400));
        }
      } else {
        next(error);
      }
    }
  };
}

// ========================================
// Plan 验证中间件导出
// ========================================

export const validateCreatePlan = createValidator(createPlanSchema, 'body');
export const validateUpdatePlan = createValidator(updatePlanSchema, 'body');
export const validateSyncPlanToStripe = createValidator(syncPlanToStripeSchema, 'body');
export const validatePlanQuery = createValidator(planQuerySchema, 'query');

// ========================================
// Module 验证中间件导出
// ========================================

export const validateCreateModule = createValidator(createModuleSchema, 'body');
export const validateUpdateModule = createValidator(updateModuleSchema, 'body');
export const validateSyncModuleToStripe = createValidator(syncModuleToStripeSchema, 'body');
export const validateModuleQuery = createValidator(moduleQuerySchema, 'query');

// ========================================
// 通用验证中间件导出
// ========================================

export const validateUuidParam = createValidator(uuidParamSchema, 'params');
