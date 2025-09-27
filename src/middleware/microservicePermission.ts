import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './jwt.js';
import { microservicePermissionService } from '../services/microservicePermissionService.js';
import { subscriptionService } from '../services/subscription.js';
import { logger } from '../utils/logger.js';

export interface MicroserviceRequest extends AuthenticatedRequest {
  microservice?: {
    requestId: string;
    organizationId: string;
    serviceKey: string;
  };
}

// 微服务权限检查中间件
export function requireMicroservicePermission(serviceKey: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authReq = req as AuthenticatedRequest;

      // 确保用户已经通过JWT认证
      if (!authReq.user) {
        res.status(401).json({
          error: 'unauthorized',
          message: '需要用户认证',
        });
        return;
      }

      // 获取组织ID (从请求参数、查询参数或header中获取)
      const organizationId =
        req.params.organizationId ||
        req.query.organizationId as string ||
        req.headers['x-organization-id'] as string;

      if (!organizationId) {
        res.status(400).json({
          error: 'missing_organization',
          message: '缺少组织ID',
        });
        return;
      }

      // 验证用户是否有权限访问该组织
      const hasOrgAccess = await subscriptionService.checkUserOrganizationAccess(
        authReq.user.id,
        organizationId
      );

      if (!hasOrgAccess) {
        res.status(403).json({
          error: 'organization_access_denied',
          message: '无权限访问该组织',
        });
        return;
      }

      // 获取组织的订阅信息来确定tier
      const subscription = await subscriptionService.getActiveSubscription(organizationId);
      if (!subscription) {
        res.status(403).json({
          error: 'no_active_subscription',
          message: '该组织没有有效的订阅',
        });
        return;
      }

      // 检查API速率限制功能权限
      const apiRateLimitCheck = await subscriptionService.checkFeatureLimit(
        organizationId,
        'api_rate_limit',
        await microservicePermissionService.getUsageCount(organizationId, serviceKey, 'hourly')
      );

      if (!apiRateLimitCheck.hasAccess || !apiRateLimitCheck.isWithinLimit) {
        const errorResponse: any = {
          error: 'api_rate_limit_exceeded',
          message: apiRateLimitCheck.hasAccess
            ? 'API请求频率超出限制'
            : '该订阅级别不支持此API',
        };

        if (apiRateLimitCheck.limit) {
          errorResponse.usage = {
            current: apiRateLimitCheck.usage,
            limit: apiRateLimitCheck.limit,
            resetTime: microservicePermissionService.getNextHourReset(),
          };
        }

        res.status(403).json(errorResponse);
        return;
      }

      // 检查微服务权限 (保留原有逻辑作为后备)
      const permissionCheck = await microservicePermissionService.checkPermission(
        organizationId,
        serviceKey,
        subscription.tier || 'basic'
      );

      if (!permissionCheck.allowed) {
        const errorResponse: any = {
          error: 'permission_denied',
          message: permissionCheck.reason || '无权限访问该微服务',
        };

        // 添加限制信息
        if (permissionCheck.currentUsage !== undefined) {
          errorResponse.usage = {
            current: permissionCheck.currentUsage,
            limit: permissionCheck.limit,
            resetTime: permissionCheck.resetTime,
          };
        }

        res.status(403).json(errorResponse);
        return;
      }

      // 记录请求开始
      const requestId = await microservicePermissionService.recordRequestStart(
        organizationId,
        serviceKey
      );

      // 将微服务信息添加到请求对象中
      (req as MicroserviceRequest).microservice = {
        requestId,
        organizationId,
        serviceKey,
      };

      // 设置请求结束时的清理逻辑
      const originalSend = res.send.bind(res);
      res.send = function(body: any) {
        // 异步记录请求结束
        microservicePermissionService.recordRequestEnd(
          organizationId,
          serviceKey,
          requestId,
          (req as any).subscriptionId || ''
        ).catch(error => {
          logger.error('Error recording request end in middleware', {
            organizationId,
            serviceKey,
            requestId,
            error: error instanceof Error ? error.message : String(error),
          });
        });

        return originalSend(body);
      };

      next();
    } catch (error) {
      logger.error('Error in microservice permission middleware', {
        serviceKey,
        userId: (req as AuthenticatedRequest).user?.id,
        error: error instanceof Error ? error.message : String(error),
      });

      res.status(500).json({
        error: 'permission_check_failed',
        message: '权限检查失败',
      });
    }
  };
}

// 获取微服务使用情况的中间件
export async function getMicroserviceUsage(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authReq = req as AuthenticatedRequest;

    if (!authReq.user) {
      res.status(401).json({
        error: 'unauthorized',
        message: '需要用户认证',
      });
      return;
    }

    const organizationId =
      req.params.organizationId ||
      req.query.organizationId as string;

    if (!organizationId) {
      res.status(400).json({
        error: 'missing_organization',
        message: '缺少组织ID',
      });
      return;
    }

    // 验证组织访问权限
    const hasOrgAccess = await subscriptionService.checkUserOrganizationAccess(
      authReq.user.id,
      organizationId
    );

    if (!hasOrgAccess) {
      res.status(403).json({
        error: 'organization_access_denied',
        message: '无权限访问该组织',
      });
      return;
    }

    const serviceKey = req.query.serviceKey as string;
    const report = await microservicePermissionService.getUsageReport(
      organizationId,
      serviceKey
    );

    res.json({
      success: true,
      data: report,
    });
  } catch (error) {
    logger.error('Error getting microservice usage', {
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'usage_report_failed',
      message: '获取使用情况失败',
    });
  }
}