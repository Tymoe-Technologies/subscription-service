import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors.js';
import { verifyJWT } from '../utils/jwtHelper.js';
import { logger } from '../utils/logger.js';

/**
 * JWT 认证中间件
 * 验证 JWT Token 并提取用户信息
 *
 * 流程:
 * 1. 提取 Authorization header 中的 token
 * 2. 使用 auth-service 的 JWKS 公钥验证 JWT 签名 (RS256)
 * 3. 检查 token 是否在黑名单中
 * 4. 提取 payload 并挂载到 req.user
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // 1. 提取 Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(
        'unauthorized',
        'Missing or invalid authorization header',
        401
      );
    }

    // 2. 提取 token
    const token = authHeader.substring(7); // 去掉 "Bearer "

    // 3. 验证 JWT 签名和黑名单
    // verifyJWT 会:
    // - 用 auth-service 的公钥验证签名 (RS256)
    // - 检查 token 是否在黑名单中
    // - 检查 token 是否过期
    const decoded = await verifyJWT(token);

    // 4. 提取用户信息并挂载到 req
    // decoded 包含:
    // - sub: userId 或 accountId
    // - userType: 'USER' 或 'ACCOUNT'
    // - organizations: 数组 (USER token) 或 organization: 对象 (ACCOUNT token)
    // - jti: token ID
    // - exp, iat: 过期和签发时间

    // 从 organizations 数组提取 organizationIds（USER token）
    // auth-service 签发的 JWT 使用 organizations: [{id, orgName, ...}]
    let organizationIds: string[] | undefined;
    if (decoded.organizations && Array.isArray(decoded.organizations)) {
      organizationIds = decoded.organizations.map(
        (org: { id: string }) => org.id
      );
    }

    // 从 organization 对象提取 organizationId（ACCOUNT token）
    // auth-service 签发的 JWT 使用 organization: {id, orgName, ...}
    let organizationId: string | undefined;
    if (decoded.organization && typeof decoded.organization === 'object') {
      organizationId = decoded.organization.id;
    }

    const user: NonNullable<typeof req.user> = {
      id: decoded.sub,  // JWT 标准字段 sub (subject)
      userId: decoded.sub,  // 兼容旧代码
      email: decoded.email || '',  // 用户邮箱
      iat: decoded.iat || 0,  // JWT issued at
      exp: decoded.exp || 0,  // JWT expires at
      userType: decoded.userType,  // 'USER' 或 'ACCOUNT'
      accountType: decoded.accountType,  // ACCOUNT 类型的子类型
      jti: decoded.jti,  // token ID (用于黑名单检查)
      organizations: decoded.organizations || [],  // 用户所属的所有组织（完整对象）
    };

    // 只在有值时才设置可选属性（避免 exactOptionalPropertyTypes 错误）
    if (organizationIds) {
      user.organizationIds = organizationIds;
    }
    if (organizationId) {
      user.organizationId = organizationId;
      user.organizationName = organizationId;
    }

    req.user = user;

    logger.debug('JWT check successful', {
      userId: user.id,
      userType: user.userType,
      jti: user.jti,
    });

    // 5. 继续执行下一个中间件
    next();
  } catch (error) {
    // 统一错误处理
    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      if (message.includes('expired')) {
        next(new AppError('token_expired', 'Token has expired', 401));
      } else if (message.includes('revoked')) {
        next(new AppError('token_revoked', 'Token has been revoked', 401));
      } else if (message.includes('invalid')) {
        next(new AppError('invalid_token', 'Invalid token', 401));
      } else {
        logger.error('JWT check failed', { error });
        next(new AppError('unauthorized', 'Authentication failed', 401));
      }
    } else {
      next(error);
    }
  }
}
