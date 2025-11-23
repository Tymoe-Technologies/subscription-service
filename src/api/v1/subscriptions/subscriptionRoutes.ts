import { Router } from 'express';
import { SubscriptionController } from './subscriptionController.js';
import { authMiddleware } from '../../../middleware/authMiddleware.js';
import { orgPermissionMiddleware } from '../../../middleware/orgPermissionMiddleware.js';
import {
  validateCheckoutRequest,
  validateOrgIdParam,
} from '../../../validators/subscriptionValidators.js';

// Create router
const router = Router();

// Create controller instance
const subscriptionController = new SubscriptionController();

// Define routes: HTTP methods + paths + middleware + functions

// 创建 Checkout Session
router.post(
    '/checkout',
    authMiddleware,              // 1. 验证 JWT token
    orgPermissionMiddleware,     // 2. 检查用户对 orgId 的权限
    validateCheckoutRequest,     // 3. 验证请求体格式
    subscriptionController.createCheckout  // 4. 执行业务逻辑
);

// 获取订阅详情
router.get(
    '/:orgId',
    authMiddleware,              // 1. 验证 JWT token
    validateOrgIdParam,          // 2. 验证路径参数
    orgPermissionMiddleware,     // 3. 检查用户对 orgId 的权限
    subscriptionController.getSubscription  // 4. 执行业务逻辑
);

// 创建 Billing Portal Session
router.post(
    '/:orgId/portal',
    authMiddleware,              // 1. 验证 JWT token
    validateOrgIdParam,          // 2. 验证路径参数
    orgPermissionMiddleware,     // 3. 检查用户对 orgId 的权限
    subscriptionController.createPortal  // 4. 执行业务逻辑
);

export default router;

