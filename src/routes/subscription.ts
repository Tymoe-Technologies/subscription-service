import { Router } from 'express';
import {
  createTrialSubscription,
  createPaidSubscription,
  upgradeSubscription,
  cancelSubscription,
  getSubscription,
  getOrganizationSubscription,
  getOrganizationSubscriptions,
  checkFeatureAccess,
  getPricing,
} from '../controllers/subscription.js';
import { validateInternalApiKey } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// 所有订阅路由都需要内部API密钥验证
router.use(asyncHandler(validateInternalApiKey));

// 创建试用订阅
router.post('/trial', asyncHandler(createTrialSubscription));

// 创建付费订阅
router.post('/paid', asyncHandler(createPaidSubscription));

// 升级订阅
router.patch('/:subscriptionId/upgrade', asyncHandler(upgradeSubscription));

// 取消订阅
router.patch('/:subscriptionId/cancel', asyncHandler(cancelSubscription));

// 获取订阅详情
router.get('/:subscriptionId', asyncHandler(getSubscription));

// 获取组织的特定产品订阅
router.get('/organization/:organizationId/product/:productKey', asyncHandler(getOrganizationSubscription));

// 获取组织的所有订阅
router.get('/organization/:organizationId', asyncHandler(getOrganizationSubscriptions));

// 检查功能权限
router.get(
  '/organization/:organizationId/product/:productKey/feature/:featureKey',
  asyncHandler(checkFeatureAccess)
);

// 获取产品定价
router.get('/pricing/:productKey', asyncHandler(getPricing));

export default router;
