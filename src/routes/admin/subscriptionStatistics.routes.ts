import { Router } from 'express';
import { subscriptionStatisticsController } from '../../controllers/subscriptionStatistics.controller.js';
import { adminAuthMiddleware } from '../../middleware/adminAuth.js';
import { validate } from '../../middleware/validate.js';
import {
  StatisticsQuerySchema,
  ListSubscriptionsQuerySchema,
} from '../../validators/subscriptionStatistics.validators.js';

const router = Router();

// 所有路由都需要Admin API Key鉴权
router.use(adminAuthMiddleware);

/**
 * @route   GET /api/subscription-service/v1/admin/statistics
 * @desc    获取全局订阅统计数据
 * @access  Admin (API Key)
 */
router.get(
  '/statistics',
  validate(StatisticsQuerySchema, 'query'),
  subscriptionStatisticsController.getStatistics.bind(subscriptionStatisticsController)
);

/**
 * @route   GET /api/subscription-service/v1/admin/subscriptions/list
 * @desc    列出所有订阅（分页、筛选、排序）
 * @access  Admin (API Key)
 */
router.get(
  '/subscriptions/list',
  validate(ListSubscriptionsQuerySchema, 'query'),
  subscriptionStatisticsController.listSubscriptions.bind(subscriptionStatisticsController)
);

export default router;
