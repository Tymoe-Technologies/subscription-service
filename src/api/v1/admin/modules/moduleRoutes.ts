import { Router } from 'express';
import { moduleController } from './moduleController.js';
import { adminAuthMiddleware } from '../../../../middleware/adminAuthMiddleware.js';
import {
  validateCreateModule,
  validateUpdateModule,
  validateSyncModuleToStripe,
  validateModuleQuery,
  validateUuidParam,
} from '../../../../validators/adminValidators.js';

const router = Router();

/**
 * Admin Module Routes
 * 所有路由都需要 Admin API Key 认证
 */

// 创建 Module
router.post(
  '/',
  adminAuthMiddleware,          // 1. Admin API Key 认证
  validateCreateModule,         // 2. 验证请求体
  moduleController.createModule // 3. 执行业务逻辑
);

// 获取所有 Modules（支持筛选和分页）
router.get(
  '/',
  adminAuthMiddleware,            // 1. Admin API Key 认证
  validateModuleQuery,            // 2. 验证查询参数
  moduleController.getAllModules  // 3. 执行业务逻辑
);

// 获取单个 Module
router.get(
  '/:id',
  adminAuthMiddleware,            // 1. Admin API Key 认证
  validateUuidParam,              // 2. 验证 UUID 参数
  moduleController.getModuleById  // 3. 执行业务逻辑
);

// 更新 Module
router.patch(
  '/:id',
  adminAuthMiddleware,          // 1. Admin API Key 认证
  validateUuidParam,            // 2. 验证 UUID 参数
  validateUpdateModule,         // 3. 验证请求体
  moduleController.updateModule // 4. 执行业务逻辑
);

// 同步 Module 到 Stripe（创建新 Price）
router.patch(
  '/:id/sync-stripe',
  adminAuthMiddleware,               // 1. Admin API Key 认证
  validateUuidParam,                 // 2. 验证 UUID 参数
  validateSyncModuleToStripe,        // 3. 验证请求体
  moduleController.syncModuleToStripe // 4. 执行业务逻辑
);

// 删除 Module（软删除）
router.delete(
  '/:id',
  adminAuthMiddleware,            // 1. Admin API Key 认证
  validateUuidParam,              // 2. 验证 UUID 参数
  moduleController.deleteModule   // 3. 执行业务逻辑
);

export default router;
