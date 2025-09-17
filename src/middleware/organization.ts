import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './jwt.js';
import { authServiceClient } from '../services/authService.js';
import { logger } from '../utils/logger.js';

export async function validateOrganizationAccess(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { organizationId } = req.params;
    const userId = (req as AuthenticatedRequest).user.id;

    if (!organizationId) {
      res.status(400).json({
        error: 'bad_request',
        message: '缺少organizationId参数',
      });
      return;
    }

    // 调用auth-service验证用户是否拥有该组织
    const hasAccess = await authServiceClient.checkUserOrganizationAccess(userId, organizationId);

    if (!hasAccess) {
      logger.warn('用户尝试访问无权限的组织', {
        userId,
        organizationId,
      });

      res.status(403).json({
        error: 'access_denied',
        message: '无权访问该店铺信息',
      });
      return;
    }

    logger.debug('组织权限验证通过', {
      userId,
      organizationId,
    });

    next();
  } catch (error) {
    logger.error('组织权限验证失败', {
      organizationId: req.params.organizationId,
      userId: (req as AuthenticatedRequest).user?.id,
      error: error instanceof Error ? error instanceof Error ? error.message : String(error) : 'Unknown error',
    });

    res.status(500).json({
      error: 'verification_failed',
      message: '权限验证失败',
    });
  }
}

// 可选的组织权限验证（某些端点可能不需要严格验证）
export async function optionalOrganizationAccess(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { organizationId } = req.params;
    const userId = (req as AuthenticatedRequest).user.id;

    if (!organizationId) {
      next();
      return;
    }

    const hasAccess = await authServiceClient.checkUserOrganizationAccess(userId, organizationId);

    // 设置访问标记，控制器可以根据此标记决定返回的数据范围
    (req as Request & { hasOrganizationAccess?: boolean }).hasOrganizationAccess = hasAccess;

    next();
  } catch (error) {
    logger.error('可选组织权限验证失败', {
      organizationId: req.params.organizationId,
      userId: (req as AuthenticatedRequest).user?.id,
      error: error instanceof Error ? error instanceof Error ? error.message : String(error) : 'Unknown error',
    });

    // 可选验证失败时不阻止请求，但设置无权限标记
    (req as Request & { hasOrganizationAccess?: boolean }).hasOrganizationAccess = false;
    next();
  }
}
