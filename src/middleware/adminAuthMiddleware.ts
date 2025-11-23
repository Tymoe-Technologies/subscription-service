import { Request, Response, NextFunction } from 'express';
import { service } from '../config/config.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Admin API Key 认证中间件
 * 验证请求头中的 X-Admin-API-Key 是否合法
 *
 * 使用方法:
 * 1. 在环境变量中配置 ADMIN_API_KEYS (逗号分隔的密钥列表)
 * 2. 在路由中使用此中间件: router.post('/admin/plans', adminAuthMiddleware, ...)
 * 3. 客户端请求时必须带上 Header: X-Admin-API-Key: <your-key>
 */
export function adminAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    // 1. 从请求头中获取 API Key
    const apiKey = req.headers['x-admin-api-key'] as string | undefined;

    if (!apiKey) {
      logger.warn('Admin API Key 缺失', {
        path: req.path,
        method: req.method,
        ip: req.ip,
      });

      next(
        new AppError(
          'unauthorized',
          'Admin API Key is required. Please provide X-Admin-API-Key header.',
          401
        )
      );
      return;
    }

    // 2. 验证 API Key 是否在允许列表中
    const validKeys = service.adminApiKeys;

    if (!validKeys || validKeys.length === 0) {
      logger.error('Admin API Keys 未配置', {
        path: req.path,
        method: req.method,
      });

      next(
        new AppError(
          'server_error',
          'Admin API Keys are not configured on the server.',
          500
        )
      );
      return;
    }

    const isValid = validKeys.includes(apiKey);

    if (!isValid) {
      logger.warn('无效的 Admin API Key', {
        path: req.path,
        method: req.method,
        ip: req.ip,
        apiKeyPrefix: apiKey.substring(0, 8) + '***', // 只记录前8位用于调试
      });

      next(
        new AppError(
          'forbidden',
          'Invalid Admin API Key. Access denied.',
          403
        )
      );
      return;
    }

    // 3. 验证通过，继续执行
    logger.info('Admin API 认证通过', {
      path: req.path,
      method: req.method,
    });

    next();
  } catch (error) {
    logger.error('Admin 认证中间件异常', { error });
    next(error);
  }
}
