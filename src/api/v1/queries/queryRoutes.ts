import { Router } from 'express';
import { queryController } from './queryController.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import {
  validateOrgIdParam,
  validateUserIdHeader,
} from '../../../validators/queryValidators.js';

const router = Router();

/**
 * 查询 API 路由
 * 基础路径: /api/subscription-service/v1/queries
 */

/**
 * GET /orgs/:orgId/subscription
 * 获取组织订阅详情
 */
router.get(
  '/orgs/:orgId/subscription',
  validateOrgIdParam,
  asyncHandler(queryController.getOrgSubscription)
);

export default router;
