import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

/**
 * Zod验证中间件工厂函数
 * 用于验证请求体、查询参数或路径参数
 */
export const validate = <T>(schema: ZodSchema<T>, source: 'body' | 'query' | 'params' = 'body') => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // 根据source选择要验证的数据
      const dataToValidate = req[source];

      // 验证数据
      const validatedData = schema.parse(dataToValidate);

      // 将验证后的数据替换原数据(类型转换后的)
      req[source] = validatedData as any;

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        // 格式化Zod错误
        const details: Record<string, string> = {};
        error.errors.forEach((err) => {
          const field = err.path.join('.');
          details[field] = err.message;
        });

        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: '请求参数验证失败',
            details,
          },
        });
        return;
      }

      // 其他未知错误
      console.error('[Validation] Unexpected error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: '参数验证过程中发生错误',
        },
      });
    }
  };
};
