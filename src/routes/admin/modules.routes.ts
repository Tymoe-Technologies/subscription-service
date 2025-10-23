import { Router } from 'express';
import { modulesController } from '../../controllers/modules.controller.js';
import { adminAuthMiddleware } from '../../middleware/adminAuth.js';
import { validate } from '../../middleware/validate.js';
import {
  CreateModuleSchema,
  UpdateModuleSchema,
  UpdateModuleStatusSchema,
  ListModulesQuerySchema,
  UuidParamSchema,
} from '../../validators/modules.validators.js';

const router = Router();

// 所有路由都需要Admin API Key鉴权
router.use(adminAuthMiddleware);

/**
 * @route   POST /api/subscription-service/v1/admin/modules
 * @desc    创建模块
 * @access  Admin (API Key)
 */
router.post(
  '/',
  validate(CreateModuleSchema, 'body'),
  modulesController.createModule.bind(modulesController)
);

/**
 * @route   GET /api/subscription-service/v1/admin/modules
 * @desc    列出所有模块(分页)
 * @access  Admin (API Key)
 */
router.get(
  '/',
  validate(ListModulesQuerySchema, 'query'),
  modulesController.listModules.bind(modulesController)
);

/**
 * @route   GET /api/subscription-service/v1/admin/modules/:id
 * @desc    查询单个模块
 * @access  Admin (API Key)
 */
router.get(
  '/:id',
  validate(UuidParamSchema, 'params'),
  modulesController.getModule.bind(modulesController)
);

/**
 * @route   PATCH /api/subscription-service/v1/admin/modules/:id
 * @desc    更新模块
 * @access  Admin (API Key)
 */
router.patch(
  '/:id',
  validate(UuidParamSchema, 'params'),
  validate(UpdateModuleSchema, 'body'),
  modulesController.updateModule.bind(modulesController)
);

/**
 * @route   DELETE /api/subscription-service/v1/admin/modules/:id
 * @desc    删除模块(软删除)
 * @access  Admin (API Key)
 */
router.delete(
  '/:id',
  validate(UuidParamSchema, 'params'),
  modulesController.deleteModule.bind(modulesController)
);

/**
 * @route   PATCH /api/subscription-service/v1/admin/modules/:id/status
 * @desc    更新模块状态
 * @access  Admin (API Key)
 */
router.patch(
  '/:id/status',
  validate(UuidParamSchema, 'params'),
  validate(UpdateModuleStatusSchema, 'body'),
  modulesController.updateModuleStatus.bind(modulesController)
);

export default router;
