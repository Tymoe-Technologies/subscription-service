import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * 组织权限检查中间件
 *
 * 验证用户是否有权限访问指定的组织
 * 必须在 authMiddleware 之后使用
 *
 * 支持两种 token 类型:
 * 1. USER token: 有 organizationIds 数组，检查 orgId 是否在数组中
 * 2. ACCOUNT token: 有 organizationId 字段，检查是否匹配
 *
 * orgId 获取优先级:
 * 1. req.body.orgId (POST/PUT/PATCH 请求)
 * 2. req.params.orgId (路径参数)
 * 3. req.query.orgId (查询参数)
 */
export async function orgPermissionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // 1. 检查是否已经通过 JWT 认证
    if (!req.user || !req.user.userId) {
      throw new AppError(
        'unauthorized',
        'User not authenticated. Please use authMiddleware first.',
        401
      );
    }

    // 2. 提取 orgId (按优先级)
    const orgId = req.body.orgId || req.params.orgId || req.query.orgId;

    if (!orgId) {
      throw new AppError(
        'bad_request',
        'Organization ID is required',
        400
      );
    }

    // 3. 检查权限
    const { userType, organizationIds, organizationId } = req.user;

    logger.debug('检查组织权限', {
      userId: req.user.userId,
      userType,
      requestedOrgId: orgId,
      userOrganizationIds: organizationIds,
      userOrganizationId: organizationId,
    });

    // 4. 根据 userType 检查权限
    if (userType === 'USER') {
      // USER token: 检查 orgId 是否在 organizationIds 数组中
      if (!organizationIds || !Array.isArray(organizationIds)) {
        logger.error('USER token 缺少 organizationIds', {
          userId: req.user.userId,
        });
        throw new AppError(
          'invalid_token',
          'Invalid token: missing organization information',
          401
        );
      }

      if (!organizationIds.includes(orgId)) {
        logger.warn('USER 无权访问组织', {
          userId: req.user.userId,
          requestedOrgId: orgId,
          allowedOrgIds: organizationIds,
        });
        throw new AppError(
          'forbidden',
          'You do not have permission to access this organization',
          403
        );
      }

      logger.debug('USER 组织权限验证通过', {
        userId: req.user.userId,
        orgId,
      });
    } else if (userType === 'ACCOUNT') {
      // ACCOUNT token: 检查 orgId 是否与 organizationId 匹配
      if (!organizationId) {
        logger.error('ACCOUNT token 缺少 organizationId', {
          userId: req.user.userId,
        });
        throw new AppError(
          'invalid_token',
          'Invalid token: missing organization information',
          401
        );
      }

      if (organizationId !== orgId) {
        logger.warn('ACCOUNT 无权访问组织', {
          userId: req.user.userId,
          requestedOrgId: orgId,
          allowedOrgId: organizationId,
        });
        throw new AppError(
          'forbidden',
          'You do not have permission to access this organization',
          403
        );
      }

      logger.debug('ACCOUNT 组织权限验证通过', {
        userId: req.user.userId,
        orgId,
      });
    } else {
      // 未知的 userType
      logger.error('未知的 userType', {
        userId: req.user.userId,
        userType,
      });
      throw new AppError(
        'invalid_token',
        'Invalid token: unknown user type',
        401
      );
    }

    // 5. 权限验证通过，继续执行
    next();
  } catch (error) {
    next(error);
  }
}
