import { Router } from 'express';
import {
  getOrganizationSubscriptionStatus,
  checkFeatureAccess,
  getProductPricing,
  getUserOrganizationsOverview,
  startTrial,
  createCheckoutSession,
  upgradeUserSubscription,
  cancelUserSubscription,
} from '../controllers/frontend.js';
import { validateUserJWT } from '../middleware/jwt.js';
import { validateOrganizationAccess } from '../middleware/organization.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// 所有前端路由都需要JWT验证
router.use(asyncHandler(validateUserJWT));

// 获取用户的所有组织概览（不需要特定组织权限）
router.get('/user/organizations-overview', asyncHandler(getUserOrganizationsOverview));

// 获取产品定价信息（不需要组织权限）
router.get('/products/:productKey/pricing', asyncHandler(getProductPricing));

// 以下路由需要组织权限验证
router.use('/organizations/:organizationId', asyncHandler(validateOrganizationAccess));

// 获取组织订阅状态（前端缓存用）
router.get('/organizations/:organizationId/subscription-status', asyncHandler(getOrganizationSubscriptionStatus));

// 检查功能权限
router.get(
  '/organizations/:organizationId/products/:productKey/features/:featureKey/access',
  asyncHandler(checkFeatureAccess)
);

// ===== 用户订阅管理 =====

// 开始试用
router.post('/organizations/:organizationId/subscriptions/start-trial', asyncHandler(startTrial));

// 创建支付会话（订阅付费套餐）
router.post('/organizations/:organizationId/subscriptions/checkout', asyncHandler(createCheckoutSession));

// 升级订阅
router.post('/organizations/:organizationId/subscriptions/upgrade', asyncHandler(upgradeUserSubscription));

// 取消订阅
router.post('/organizations/:organizationId/subscriptions/cancel', asyncHandler(cancelUserSubscription));

export default router;
