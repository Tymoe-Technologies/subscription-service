import { Request, Response } from 'express';
import { logger } from '../utils/logger.js';

interface ErrorWithCode {
  code?: string;
  meta?: { target?: string };
  message?: string;
  type?: string;
  errors?: unknown[];
  name?: string;
}

// 全局错误处理中间件
export function errorHandler(error: ErrorWithCode, _req: Request, res: Response): void {
  logger.error('未处理的错误', { error: error.message ?? String(error) });

  // Prisma错误处理
  if (error.code?.startsWith('P')) {
    switch (error.code) {
      case 'P2002':
        res.status(409).json({
          error: 'conflict',
          message: '数据已存在',
          detail: error.meta?.target ?? '唯一约束冲突',
        });
        return;
      case 'P2025':
        res.status(404).json({
          error: 'not_found',
          message: '记录不存在',
        });
        return;
      case 'P2003':
        res.status(400).json({
          error: 'bad_request',
          message: '外键约束失败',
        });
        return;
      default:
        res.status(500).json({
          error: 'database_error',
          message: '数据库操作失败',
        });
        return;
    }
  }

  // Stripe错误处理
  if (error.type?.startsWith('Stripe')) {
    res.status(400).json({
      error: 'stripe_error',
      message: error instanceof Error ? error.message : String(error) ?? 'Stripe操作失败',
      code: error.code,
    });
    return;
  }

  // Zod验证错误
  if (error.name === 'ZodError') {
    res.status(400).json({
      error: 'validation_error',
      message: '输入数据验证失败',
      details: error.errors,
    });
    return;
  }

  // 默认错误响应
  res.status(500).json({
    error: 'server_error',
    message: '服务器内部错误',
  });
}

// 404处理中间件
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: 'not_found',
    message: `路由 ${req.method} ${req.path} 不存在`,
  });
}
