import { Router } from 'express';
import { internalController } from '../controllers/internal.controller.js';
import { validateInternalApiKey } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  CheckQuotaSchema,
  CheckAccessSchema,
  SuspendResourceSchema,
  RestoreResourceSchema,
  RecordUsageSchema,
  BatchRecordUsageSchema,
  StatsActiveResourcesSchema,
} from '../validators/internal.validators.js';

const router = Router();

// 所有内部API路由都需要API Key验证
router.use(validateInternalApiKey);

/**
 * @route   POST /api/subscription-service/v1/internal/quota/check
 * @desc    检查资源配额（创建设备/账号前）
 * @access  Internal (Service API Key)
 */
router.post(
  '/quota/check',
  validate(CheckQuotaSchema, 'body'),
  internalController.checkQuota.bind(internalController)
);

/**
 * @route   POST /api/subscription-service/v1/internal/access/check
 * @desc    检查设备/账号访问权限（登录时）
 * @access  Internal (Service API Key)
 */
router.post(
  '/access/check',
  validate(CheckAccessSchema, 'body'),
  internalController.checkAccess.bind(internalController)
);

/**
 * @route   POST /api/subscription-service/v1/internal/resources/suspend
 * @desc    暂停设备/账号
 * @access  Internal (Service API Key)
 */
router.post(
  '/resources/suspend',
  validate(SuspendResourceSchema, 'body'),
  internalController.suspendResource.bind(internalController)
);

/**
 * @route   POST /api/subscription-service/v1/internal/resources/restore
 * @desc    恢复设备/账号
 * @access  Internal (Service API Key)
 */
router.post(
  '/resources/restore',
  validate(RestoreResourceSchema, 'body'),
  internalController.restoreResource.bind(internalController)
);

/**
 * @route   POST /api/subscription-service/v1/internal/usage/record
 * @desc    记录使用量（SMS/API Call等）
 * @access  Internal (Service API Key)
 */
router.post(
  '/usage/record',
  validate(RecordUsageSchema, 'body'),
  internalController.recordUsage.bind(internalController)
);

/**
 * @route   POST /api/subscription-service/v1/internal/usage/batch
 * @desc    批量记录使用量
 * @access  Internal (Service API Key)
 */
router.post(
  '/usage/batch',
  validate(BatchRecordUsageSchema, 'body'),
  internalController.batchRecordUsage.bind(internalController)
);

/**
 * @route   POST /api/subscription-service/v1/internal/stats/active-resources
 * @desc    统计活跃资源数量（auth-service定期同步）
 * @access  Internal (Service API Key)
 */
router.post(
  '/stats/active-resources',
  validate(StatsActiveResourcesSchema, 'body'),
  internalController.statsActiveResources.bind(internalController)
);

export default router;
