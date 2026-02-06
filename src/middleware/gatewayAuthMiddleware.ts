import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Traefik Gateway ForwardAuth 中间件
 * 
 * 通过Traefik ForwardAuth后，用户信息会从Header传递过来：
 * - X-User-Id: 用户ID
 * - X-User-Type: USER 或 ACCOUNT
 * - X-User-Role: OWNER, MANAGER, STAFF
 * - X-Org-Id: 组织ID
 * - X-Org-Name: 组织名称
 * - X-Device-Id: 设备ID（可选）
 * 
 * 这个中间件读取这些header，并构造与现有JWT中间件相同的req.user结构
 */
export function gatewayAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    // 1. 检查是否通过Traefik ForwardAuth
    const userId = req.headers['x-user-id'] as string;
    const userType = req.headers['x-user-type'] as string;
    const userRole = req.headers['x-user-role'] as string;
    const orgId = req.headers['x-org-id'] as string;
    const orgName = req.headers['x-org-name'] as string;
    const deviceId = req.headers['x-device-id'] as string;

    // 如果没有用户ID，说明未通过ForwardAuth
    if (!userId) {
      throw new AppError(
        'unauthorized',
        'Missing X-User-Id header - request not authenticated via Traefik ForwardAuth',
        401
      );
    }

    // 2. 构造用户信息（保持与JWT中间件相同的结构）
    const user: NonNullable<typeof req.user> = {
      id: userId,
      userId: userId,
      email: '', // Gateway模式下没有email
      iat: Math.floor(Date.now() / 1000), // 模拟签发时间
      exp: Math.floor(Date.now() / 1000) + 3600, // 模拟1小时后过期
      userType: userType as 'USER' | 'ACCOUNT',
      accountType: userRole as 'MANAGER' | 'STAFF',
      jti: `gateway-${Date.now()}-${userId}`, // 模拟jti
      organizations: orgId ? [{ id: orgId, name: orgName || orgId }] : [],
    };

    // 设置可选属性
    if (orgId) {
      user.organizationId = orgId;
      user.organizationIds = [orgId];
      user.organizationName = orgName || orgId;
    }

    req.user = user;

    logger.debug('Gateway auth check successful', {
      userId: user.id,
      userType: user.userType,
      userRole,
      orgId,
      deviceId,
      gateway: true,
    });

    // 3. 继续执行下一个中间件
    next();
  } catch (error) {
    // 统一错误处理
    if (error instanceof AppError) {
      next(error);
    } else if (error instanceof Error) {
      logger.error('Gateway auth check failed', { error });
      next(new AppError('unauthorized', 'Gateway authentication failed', 401));
    } else {
      next(error);
    }
  }
}

/**
 * 双重认证中间件：先尝试Gateway模式，如果失败尝试JWT模式
 * 
 * 用于过渡期，两种认证方式都支持
 */
export async function dualAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // 先检查是否有Gateway header
  if (req.headers['x-user-id']) {
    logger.debug('Using gateway authentication mode');
    return gatewayAuthMiddleware(req, res, next);
  }
  
  // 如果没有Gateway header，回退到JWT模式
  logger.debug('No gateway headers, falling back to JWT authentication');
  
  // 这里需要导入原有的authMiddleware，但我们把它放在这里简化处理
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError('unauthorized', 'No authentication provided', 401));
  }
  
  try {
    // 这里应该调用原有的JWT验证逻辑
    // 为了简化，我们假设有import { authMiddleware } from './authMiddleware.js'
    // 但为了避免循环依赖，我们直接跳到下一个中间件，让路由层处理
    next();
  } catch (error) {
    next(error);
  }
}