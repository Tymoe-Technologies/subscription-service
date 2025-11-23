import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../utils/errors.js';

/**
 * 创建 Checkout Session 请求验证 Schema
 */
const checkoutRequestSchema = z.object({
  orgId: z.string().min(1).max(255),
  planKey: z.string().min(1).max(100),
  moduleKeys: z.array(z.string().min(1).max(100)).optional().default([]),
});

/**
 * orgId 路径参数验证 Schema
 */
const orgIdParamSchema = z.object({
  orgId: z.string().min(1, 'orgId is required').max(255, 'orgId is too long'),
});

/**
 * 验证创建 Checkout Session 的请求体
 */
export function validateCheckoutRequest(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    // 使用 Zod 验证并转换数据
    const validated = checkoutRequestSchema.parse(req.body);

    // 将验证后的数据覆盖原始 body
    req.body = validated;

    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      // 将 Zod 的错误转换成 AppError
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
}

/**
 * 验证 orgId 路径参数
 */
export function validateOrgIdParam(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    // 使用 Zod 验证路径参数
    const validated = orgIdParamSchema.parse(req.params);

    // 将验证后的数据覆盖原始 params
    req.params = validated;

    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      // 将 Zod 的错误转换成 AppError
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
}
