import { Request, Response, NextFunction } from 'express';

/**
 * Admin API Key 鉴权中间件
 * 用于管理员API端点的鉴权
 *
 * 使用方式:
 * - 在.env中配置 ADMIN_API_KEYS（支持多个，逗号分隔）
 * - 请求头中携带 X-Admin-API-Key: <其中一个有效的KEY>
 */
export const adminAuthMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    // 1. 从请求头获取 API Key
    const providedApiKey = req.headers['x-admin-api-key'] as string;

    // 2. 检查API Key是否提供
    if (!providedApiKey) {
      res.status(401).json({
        success: false,
        error: {
          code: 'MISSING_API_KEY',
          message: 'Missing admin API key',
        },
      });
      return;
    }

    // 3. 从环境变量获取配置的API Keys (支持多个)
    const configuredApiKeys = process.env.ADMIN_API_KEYS;

    // 4. 检查环境变量是否配置
    if (!configuredApiKeys) {
      console.error('[AdminAuth] ADMIN_API_KEYS not configured in environment variables');
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Server configuration error',
        },
      });
      return;
    }

    // 5. 解析API Keys列表（支持逗号分隔的多个key）
    const validApiKeys = configuredApiKeys.split(',').map(key => key.trim());

    // 6. 严格比对API Key (检查是否在有效列表中)
    if (!validApiKeys.includes(providedApiKey)) {
      // 记录失败尝试(仅记录前4位和后4位)
      const maskedKey =
        providedApiKey.length >= 8
          ? `${providedApiKey.slice(0, 4)}****${providedApiKey.slice(-4)}`
          : '****';
      console.warn(`[AdminAuth] Invalid API key attempt: ${maskedKey}`);

      res.status(403).json({
        success: false,
        error: {
          code: 'INVALID_API_KEY',
          message: 'Invalid admin API key',
        },
      });
      return;
    }

    // 6. 验证成功,放行
    console.log('[AdminAuth] Admin API key validated successfully');
    next();
  } catch (error) {
    console.error('[AdminAuth] Unexpected error:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Error occurred during authentication',
      },
    });
  }
};
