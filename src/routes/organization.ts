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
} from '../controllers/organization.js';
import { validateInternalApiKey } from '../middleware/auth.js';

const router = Router();

// 所有组织路由都需要内部API密钥验证
router.use(validateInternalApiKey);

// 创建组织
router.post('/', createOrganization);

// 获取组织列表（管理员用）
router.get('/', listOrganizations);

// 获取组织信息
router.get('/:organizationId', getOrganization);

// 获取组织及其订阅信息
router.get('/:organizationId/subscriptions', getOrganizationWithSubscriptions);

// 获取组织缓存信息（专为前端缓存设计）
router.get('/:organizationId/cache-info', getOrganizationCacheInfo);

// 更新组织信息
router.patch('/:organizationId', updateOrganization);

// 获取试用状态
router.get('/:organizationId/trial-status', getTrialStatus);

// 删除组织
router.delete('/:organizationId', deleteOrganization);

export default router;