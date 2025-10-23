import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { AppError } from '../utils/errors.js';

export function errorHandler(
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  logger.error('Request error', {
    error: error.message,
    stack: error.stack,
    method: req.method,
    url: req.url,
    body: req.body
  });

  // Don't expose stack traces in production
  const isDevelopment = process.env.NODE_ENV === 'development';

  // 处理AppError（自定义应用错误）
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.data && { data: error.data }),
        ...(isDevelopment && error.stack && { stack: error.stack })
      }
    });
  }

  // 处理普通Error
  res.status(500).json({
    success: false,
    error: {
      code: 'SERVER_ERROR',
      message: isDevelopment ? error.message : 'Internal server error',
      ...(isDevelopment && error.stack && { stack: error.stack })
    }
  });
}