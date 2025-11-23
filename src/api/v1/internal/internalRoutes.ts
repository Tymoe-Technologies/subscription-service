import { Router } from 'express';
import { internalController } from './internalController.js';
import { serviceAuthMiddleware } from '../../../middleware/serviceAuthMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';

const router = Router();

/**
 * 内部 API 路由
 * 基础路径: /api/subscription-service/v1/internal
 * 所有路由都需要 Service API Key 认证
 */

// 应用 Service API Key 认证中间件到所有路由
router.use(serviceAuthMiddleware);

/**
 * GET /org/:orgId/module-quotas
 * 获取组织模块配额
 */
router.get(
  '/org/:orgId/module-quotas',
  asyncHandler(internalController.getOrgModuleQuotas)
);

export default router;
