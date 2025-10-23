import { Router } from 'express';
import { resourcesController } from '../../controllers/resources.controller.js';
import { adminAuthMiddleware } from '../../middleware/adminAuth.js';
import { validate } from '../../middleware/validate.js';
import {
  CreateResourceSchema,
  UpdateResourceSchema,
  UpdateResourceStatusSchema,
  ListResourcesQuerySchema,
  UuidParamSchema,
} from '../../validators/resources.validators.js';

const router = Router();

// 所有路由都需要Admin API Key鉴权
router.use(adminAuthMiddleware);

/**
 * @route   POST /api/subscription-service/v1/admin/resources
 * @desc    创建资源
 * @access  Admin (API Key)
 */
router.post(
  '/',
  validate(CreateResourceSchema, 'body'),
  resourcesController.createResource.bind(resourcesController)
);

/**
 * @route   GET /api/subscription-service/v1/admin/resources
 * @desc    列出所有资源(分页)
 * @access  Admin (API Key)
 */
router.get(
  '/',
  validate(ListResourcesQuerySchema, 'query'),
  resourcesController.listResources.bind(resourcesController)
);

/**
 * @route   GET /api/subscription-service/v1/admin/resources/:id
 * @desc    查询单个资源
 * @access  Admin (API Key)
 */
router.get(
  '/:id',
  validate(UuidParamSchema, 'params'),
  resourcesController.getResource.bind(resourcesController)
);

/**
 * @route   PATCH /api/subscription-service/v1/admin/resources/:id
 * @desc    更新资源
 * @access  Admin (API Key)
 */
router.patch(
  '/:id',
  validate(UuidParamSchema, 'params'),
  validate(UpdateResourceSchema, 'body'),
  resourcesController.updateResource.bind(resourcesController)
);

/**
 * @route   DELETE /api/subscription-service/v1/admin/resources/:id
 * @desc    删除资源(软删除)
 * @access  Admin (API Key)
 */
router.delete(
  '/:id',
  validate(UuidParamSchema, 'params'),
  resourcesController.deleteResource.bind(resourcesController)
);

/**
 * @route   PATCH /api/subscription-service/v1/admin/resources/:id/status
 * @desc    更新资源状态
 * @access  Admin (API Key)
 */
router.patch(
  '/:id/status',
  validate(UuidParamSchema, 'params'),
  validate(UpdateResourceStatusSchema, 'body'),
  resourcesController.updateResourceStatus.bind(resourcesController)
);

export default router;
