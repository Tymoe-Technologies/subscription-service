import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../utils/errors.js';

/**
 * orgId 路径参数验证 Schema
 */
const orgIdParamSchema = z.object({
  orgId: z.string().min(1, 'orgId is required').max(255, 'orgId is too long'),
});

/**
 * X-User-ID header 验证 Schema
 */
const userIdHeaderSchema = z.object({
  'x-user-id': z.string().min(1, 'X-User-ID header is required'),
});

/**
 * 验证 orgId 路径参数
 */
export function validateOrgIdParam(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    const validated = orgIdParamSchema.parse(req.params);
    req.params = validated;
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
}

/**
 * 验证 X-User-ID header
 */
export function validateUserIdHeader(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    const validated = userIdHeaderSchema.parse(req.headers);
    // 验证通过，继续执行
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
}
