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

const router = Router();

// 所有订阅路由都需要内部API密钥验证
router.use(validateInternalApiKey);

// 创建试用订阅
router.post('/trial', createTrialSubscription);

// 创建付费订阅
router.post('/paid', createPaidSubscription);

// 升级订阅
router.patch('/:subscriptionId/upgrade', upgradeSubscription);

// 取消订阅
router.patch('/:subscriptionId/cancel', cancelSubscription);

// 获取订阅详情
router.get('/:subscriptionId', getSubscription);

// 获取组织的特定产品订阅
router.get('/organization/:organizationId/product/:productKey', getOrganizationSubscription);

// 获取组织的所有订阅
router.get('/organization/:organizationId', getOrganizationSubscriptions);

// 检查功能权限
router.get('/organization/:organizationId/product/:productKey/feature/:featureKey', checkFeatureAccess);

// 获取产品定价
router.get('/pricing/:productKey', getPricing);

export default router;