import { Router } from 'express';
import { validateUserJWT } from '../middleware/jwt.js';
import { getMicroserviceUsage } from '../middleware/microservicePermission.js';
import { microservicePermissionService } from '../services/microservicePermissionService.js';
import { subscriptionService } from '../services/subscription.js';
import { getMicroserviceAccess, getAccessibleMicroservices } from '../config/microservices.js';
import { logger } from '../utils/logger.js';

const router = Router();

// 获取微服务使用情况
router.get('/usage/:organizationId', validateUserJWT, getMicroserviceUsage);

// 检查微服务权限
router.post('/check-permission', validateUserJWT, async (req, res) => {
  try {
    const { organizationId, serviceKey } = req.body;

    if (!organizationId || !serviceKey) {
      return res.status(400).json({
        error: 'missing_parameters',
        message: 'Missing required parameters: organizationId, serviceKey',
      });
    }

    // 获取组织的活跃订阅
    const subscription = await subscriptionService.getActiveSubscription(organizationId as string);
    if (!subscription) {
      return res.status(403).json({
        error: 'no_active_subscription',
        message: 'This organization does not have a valid subscription',
      });
    }

    // 检查权限
    const permissionCheck = await microservicePermissionService.checkPermission(
      organizationId,
      serviceKey,
      subscription.tier || 'basic'
    );

    res.json({
      success: true,
      data: {
        allowed: permissionCheck.allowed,
        reason: permissionCheck.reason,
        currentUsage: permissionCheck.currentUsage,
        limit: permissionCheck.limit,
        resetTime: permissionCheck.resetTime,
        tier: subscription.tier || 'basic',
      },
    });
    return;
  } catch (error) {
    logger.error('Failed to check microservice permission', {
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'permission_check_failed',
      message: 'Permission check failed',
    });
    return;
  }
});

// 获取组织可访问的微服务列表
router.get('/accessible/:organizationId', validateUserJWT, async (req, res) => {
  try {
    const { organizationId } = req.params;

    // 获取组织的活跃订阅
    const subscription = await subscriptionService.getActiveSubscription(organizationId as string);
    if (!subscription) {
      return res.status(403).json({
        error: 'no_active_subscription',
        message: 'This organization does not have a valid subscription',
      });
    }

    // 获取可访问的微服务列表
    const accessibleServices = getAccessibleMicroservices(subscription.tier || 'basic');

    // 获取每个服务的详细限制信息
    const servicesWithLimits = accessibleServices.map(serviceKey => {
      const limits = getMicroserviceAccess(subscription.tier || 'basic', serviceKey);
      return {
        serviceKey,
        limits,
      };
    });

    res.json({
      success: true,
      data: {
        tier: subscription.tier || 'basic',
        services: servicesWithLimits,
      },
    });
    return;
  } catch (error) {
    logger.error('Failed to get accessible microservices list', {
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'get_accessible_services_failed',
      message: 'Failed to get accessible microservices list',
    });
    return;
  }
});

// 获取组织的所有微服务使用统计
router.get('/stats/:organizationId', validateUserJWT, async (req, res) => {
  try {
    const { organizationId } = req.params;
    const serviceKey = req.query.serviceKey as string | undefined;
    const periodType = req.query.periodType as string | undefined;

    // 验证用户组织访问权限
    const authReq = req as any;
    const hasAccess = await subscriptionService.checkUserOrganizationAccess(
      authReq.user.id,
      organizationId as string
    );

    if (!hasAccess) {
      return res.status(403).json({
        error: 'organization_access_denied',
        message: 'No permission to access this organization',
      });
    }

    // 获取使用统计
    const report = await microservicePermissionService.getUsageReport(
      organizationId as string,
      serviceKey
    );

    // 获取订阅信息
    const subscription = await subscriptionService.getActiveSubscription(organizationId as string);

    res.json({
      success: true,
      data: {
        organizationId,
        tier: subscription?.tier || 'unknown',
        usage: report.usage,
        concurrent: report.concurrent,
        timestamp: new Date().toISOString(),
      },
    });
    return;
  } catch (error) {
    logger.error('Failed to get microservice usage statistics', {
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'get_usage_stats_failed',
      message: 'Failed to get usage statistics',
    });
    return;
  }
});

// 清理过期的并发请求记录（管理接口）
router.post('/cleanup-expired', async (req, res) => {
  try {
    // 这里应该添加管理员权限验证
    await microservicePermissionService.cleanupExpiredConcurrentRequests();

    res.json({
      success: true,
      message: 'Cleanup completed',
    });
  } catch (error) {
    logger.error('Failed to cleanup expired request records', {
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'cleanup_failed',
      message: 'Cleanup failed',
    });
  }
});

export default router;