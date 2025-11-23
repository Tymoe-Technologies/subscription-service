import { Router } from 'express';
import { planController } from './planController.js';
import { adminAuthMiddleware } from '../../../../middleware/adminAuthMiddleware.js';
import {
  validateCreatePlan,
  validateUpdatePlan,
  validateSyncPlanToStripe,
  validatePlanQuery,
  validateUuidParam,
} from '../../../../validators/adminValidators.js';

const router = Router();

/**
 * Admin Plan Routes
 * 所有路由都需要 Admin API Key 认证
 */

// 创建 Plan
router.post(
  '/',
  adminAuthMiddleware,      // 1. Admin API Key 认证
  validateCreatePlan,        // 2. 验证请求体
  planController.createPlan  // 3. 执行业务逻辑
);

// 获取所有 Plans（支持筛选和分页）
router.get(
  '/',
  adminAuthMiddleware,        // 1. Admin API Key 认证
  validatePlanQuery,          // 2. 验证查询参数
  planController.getAllPlans  // 3. 执行业务逻辑
);

// 获取单个 Plan
router.get(
  '/:id',
  adminAuthMiddleware,         // 1. Admin API Key 认证
  validateUuidParam,           // 2. 验证 UUID 参数
  planController.getPlanById   // 3. 执行业务逻辑
);

// 更新 Plan
router.patch(
  '/:id',
  adminAuthMiddleware,       // 1. Admin API Key 认证
  validateUuidParam,         // 2. 验证 UUID 参数
  validateUpdatePlan,        // 3. 验证请求体
  planController.updatePlan  // 4. 执行业务逻辑
);

// 同步 Plan 到 Stripe（创建新 Price）
router.patch(
  '/:id/sync-stripe',
  adminAuthMiddleware,            // 1. Admin API Key 认证
  validateUuidParam,              // 2. 验证 UUID 参数
  validateSyncPlanToStripe,       // 3. 验证请求体
  planController.syncPlanToStripe // 4. 执行业务逻辑
);

// 删除 Plan
router.delete(
  '/:id',
  adminAuthMiddleware,         // 1. Admin API Key 认证
  validateUuidParam,           // 2. 验证 UUID 参数
  planController.deletePlan    // 3. 执行业务逻辑
);

export default router;
