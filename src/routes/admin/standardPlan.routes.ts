import { Router } from 'express';
import { standardPlanController } from '../../controllers/standardPlan.controller.js';
import { adminAuthMiddleware } from '../../middleware/adminAuth.js';
import { validate } from '../../middleware/validate.js';
import {
  CreateStandardPlanSchema,
  UpdateStandardPlanSchema,
  ListStandardPlanQuerySchema,
  UuidParamSchema,
} from '../../validators/standardPlan.validators.js';

const router = Router();

// 所有路由都需要Admin API Key鉴权
router.use(adminAuthMiddleware);

/**
 * @route   POST /api/subscription-service/v1/admin/standard-plan
 * @desc    创建Standard Plan
 * @access  Admin (API Key)
 */
router.post(
  '/',
  validate(CreateStandardPlanSchema, 'body'),
  standardPlanController.createStandardPlan.bind(standardPlanController)
);

/**
 * @route   GET /api/subscription-service/v1/admin/standard-plan
 * @desc    查询当前ACTIVE的Standard Plan
 * @access  Admin (API Key)
 */
router.get(
  '/',
  standardPlanController.getActiveStandardPlan.bind(standardPlanController)
);

/**
 * @route   GET /api/subscription-service/v1/admin/standard-plan/list
 * @desc    列出所有Standard Plan版本（分页）
 * @access  Admin (API Key)
 */
router.get(
  '/list',
  validate(ListStandardPlanQuerySchema, 'query'),
  standardPlanController.listStandardPlans.bind(standardPlanController)
);

/**
 * @route   GET /api/subscription-service/v1/admin/standard-plan/:id
 * @desc    查询单个Standard Plan
 * @access  Admin (API Key)
 */
router.get(
  '/:id',
  validate(UuidParamSchema, 'params'),
  standardPlanController.getStandardPlan.bind(standardPlanController)
);

/**
 * @route   PATCH /api/subscription-service/v1/admin/standard-plan/:id
 * @desc    更新Standard Plan
 * @access  Admin (API Key)
 */
router.patch(
  '/:id',
  validate(UuidParamSchema, 'params'),
  validate(UpdateStandardPlanSchema, 'body'),
  standardPlanController.updateStandardPlan.bind(standardPlanController)
);

/**
 * @route   PATCH /api/subscription-service/v1/admin/standard-plan/:id/activate
 * @desc    激活Standard Plan
 * @access  Admin (API Key)
 */
router.patch(
  '/:id/activate',
  validate(UuidParamSchema, 'params'),
  standardPlanController.activateStandardPlan.bind(standardPlanController)
);

/**
 * @route   DELETE /api/subscription-service/v1/admin/standard-plan/:id
 * @desc    删除Standard Plan（软删除）
 * @access  Admin (API Key)
 */
router.delete(
  '/:id',
  validate(UuidParamSchema, 'params'),
  standardPlanController.deleteStandardPlan.bind(standardPlanController)
);

export default router;
