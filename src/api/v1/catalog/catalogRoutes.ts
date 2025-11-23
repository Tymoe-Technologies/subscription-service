import { Router } from 'express';
import { catalogController } from './catalogController.js';

const router = Router();

/**
 * Catalog Routes（公开接口，无需认证）
 * 用于前端展示可选的订阅计划和附加模块
 */

// 获取所有可用的 Plans
router.get('/plans', catalogController.getPlans);

// 根据 key 获取单个 Plan
router.get('/plans/:key', catalogController.getPlanByKey);

// 获取所有可用的 Modules
router.get('/modules', catalogController.getModules);

// 根据 key 获取单个 Module
router.get('/modules/:key', catalogController.getModuleByKey);

export default router;
