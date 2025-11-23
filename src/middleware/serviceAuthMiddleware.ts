import { Request, Response, NextFunction } from 'express';
import { service } from '../config/config.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Service API Key 认证中间件
 * 验证请求头中的 X-Service-API-Key 是否合法
 * 用于内部微服务之间的调用认证
 */
export function serviceAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    // 1. 从请求头中获取 Service API Key
    const apiKey = req.headers['x-service-api-key'] as string | undefined;

    if (!apiKey) {
      logger.warn('Service API Key 缺失', {
        path: req.path,
        method: req.method,
        ip: req.ip,
      });

      next(
        new AppError(
          'unauthorized',
          'Service API Key is required. Please provide X-Service-API-Key header.',
          401
        )
      );
      return;
    }

    // 2. 验证 API Key 是否正确
    const validKey = service.security.internalApiKey;

    if (!validKey) {
      logger.error('Internal API Key 未配置', {
        path: req.path,
        method: req.method,
      });

      next(
        new AppError(
          'server_error',
          'Internal API Key is not configured on the server.',
          500
        )
      );
      return;
    }

    const isValid = apiKey === validKey;

    if (!isValid) {
      logger.warn('无效的 Service API Key', {
        path: req.path,
        method: req.method,
        ip: req.ip,
        apiKeyPrefix: apiKey.substring(0, 8) + '***',
      });

      next(
        new AppError(
          'forbidden',
          'Invalid Service API Key. Access denied.',
          403
        )
      );
      return;
    }

    // 3. 验证通过，继续执行
    logger.info('Service API 认证通过', {
      path: req.path,
      method: req.method,
    });

    next();
  } catch (error) {
    logger.error('Service 认证中间件异常', { error });
    next(error);
  }
}
