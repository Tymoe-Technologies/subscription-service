import { Router } from 'express';
import {
  createOrganization,
  getOrganization,
  getOrganizationWithSubscriptions,
  getOrganizationCacheInfo,
  updateOrganization,
  getTrialStatus,
  deleteOrganization,
  listOrganizations,
  getOrganizationFeatures,
} from '../controllers/organization.js';
import { validateInternalApiKey } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// 所有组织路由都需要内部API密钥验证
router.use(asyncHandler(validateInternalApiKey));

// 创建组织
router.post('/', asyncHandler(createOrganization));

// 获取组织列表（管理员用）
router.get('/', asyncHandler(listOrganizations));

// 获取组织信息
router.get('/:organizationId', asyncHandler(getOrganization));

// 获取组织及其订阅信息
router.get('/:organizationId/subscriptions', asyncHandler(getOrganizationWithSubscriptions));

// 获取组织缓存信息（专为前端缓存设计）
router.get('/:organizationId/cache-info', asyncHandler(getOrganizationCacheInfo));

// 更新组织信息
router.patch('/:organizationId', asyncHandler(updateOrganization));

// 获取试用状态
router.get('/:organizationId/trial-status', asyncHandler(getTrialStatus));

// 获取组织功能权限配置
router.get('/:organizationId/features', asyncHandler(getOrganizationFeatures));

// 删除组织
router.delete('/:organizationId', asyncHandler(deleteOrganization));

export default router;
