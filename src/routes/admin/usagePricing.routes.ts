import { Router } from 'express';
import { usagePricingController } from '../../controllers/usagePricing.controller.js';
import { adminAuthMiddleware } from '../../middleware/adminAuth.js';
import { validate } from '../../middleware/validate.js';
import {
  CreateUsagePricingSchema,
  UpdateUsagePricingSchema,
  UpdateUsagePricingStatusSchema,
  ListUsagePricingQuerySchema,
  UuidParamSchema,
} from '../../validators/usagePricing.validators.js';

const router = Router();

// 所有路由都需要Admin API Key鉴权
router.use(adminAuthMiddleware);

/**
 * @route   POST /api/subscription-service/v1/admin/usage-pricing
 * @desc    创建按量计费规则
 * @access  Admin (API Key)
 */
router.post(
  '/',
  validate(CreateUsagePricingSchema, 'body'),
  usagePricingController.createUsagePricing.bind(usagePricingController)
);

/**
 * @route   GET /api/subscription-service/v1/admin/usage-pricing
 * @desc    列出所有按量计费规则(分页)
 * @access  Admin (API Key)
 */
router.get(
  '/',
  validate(ListUsagePricingQuerySchema, 'query'),
  usagePricingController.listUsagePricing.bind(usagePricingController)
);

/**
 * @route   GET /api/subscription-service/v1/admin/usage-pricing/:id
 * @desc    查询单个按量计费规则
 * @access  Admin (API Key)
 */
router.get(
  '/:id',
  validate(UuidParamSchema, 'params'),
  usagePricingController.getUsagePricing.bind(usagePricingController)
);

/**
 * @route   PATCH /api/subscription-service/v1/admin/usage-pricing/:id
 * @desc    更新按量计费规则
 * @access  Admin (API Key)
 */
router.patch(
  '/:id',
  validate(UuidParamSchema, 'params'),
  validate(UpdateUsagePricingSchema, 'body'),
  usagePricingController.updateUsagePricing.bind(usagePricingController)
);

/**
 * @route   PATCH /api/subscription-service/v1/admin/usage-pricing/:id/status
 * @desc    更新按量计费规则状态（启用/禁用）
 * @access  Admin (API Key)
 */
router.patch(
  '/:id/status',
  validate(UuidParamSchema, 'params'),
  validate(UpdateUsagePricingStatusSchema, 'body'),
  usagePricingController.updateUsagePricingStatus.bind(usagePricingController)
);

export default router;
