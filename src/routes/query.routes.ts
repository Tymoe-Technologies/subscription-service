import { Router } from 'express';
import { queryController } from '../controllers/query.controller.js';
import { verifyJwtMiddleware, requireUserType } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  GetInvoicesQuerySchema,
  InvoiceIdParamsSchema,
  GetUsageQuerySchema,
  GetUsageSummaryQuerySchema,
  GetLogsQuerySchema,
} from '../validators/query.validators.js';

const router = Router();

// 所有路由都需要JWT验证和USER类型验证
router.use(verifyJwtMiddleware);
router.use(requireUserType);

/**
 * @route   GET /api/subscription-service/v1/queries/subscription
 * @desc    查询当前订阅详情
 * @access  User (JWT Token, userType=USER)
 */
router.get(
  '/subscription',
  queryController.getCurrentSubscription.bind(queryController)
);

/**
 * @route   GET /api/subscription-service/v1/queries/invoices
 * @desc    查询账单历史（分页、筛选）
 * @access  User (JWT Token, userType=USER)
 */
router.get(
  '/invoices',
  validate(GetInvoicesQuerySchema, 'query'),
  queryController.getInvoices.bind(queryController)
);

/**
 * @route   GET /api/subscription-service/v1/queries/invoices/:invoiceId
 * @desc    查询单个发票详情
 * @access  User (JWT Token, userType=USER)
 */
router.get(
  '/invoices/:invoiceId',
  validate(InvoiceIdParamsSchema, 'params'),
  queryController.getInvoiceById.bind(queryController)
);

/**
 * @route   GET /api/subscription-service/v1/queries/usage
 * @desc    查询使用量明细（分页、筛选）
 * @access  User (JWT Token, userType=USER)
 */
router.get(
  '/usage',
  validate(GetUsageQuerySchema, 'query'),
  queryController.getUsage.bind(queryController)
);

/**
 * @route   GET /api/subscription-service/v1/queries/usage/summary
 * @desc    查询使用量统计汇总
 * @access  User (JWT Token, userType=USER)
 */
router.get(
  '/usage/summary',
  validate(GetUsageSummaryQuerySchema, 'query'),
  queryController.getUsageSummary.bind(queryController)
);

/**
 * @route   GET /api/subscription-service/v1/queries/preview-activation
 * @desc    预览激活后费用
 * @access  User (JWT Token, userType=USER)
 */
router.get(
  '/preview-activation',
  queryController.previewActivation.bind(queryController)
);

/**
 * @route   GET /api/subscription-service/v1/queries/quotas
 * @desc    查询可用配额和使用情况
 * @access  User (JWT Token, userType=USER)
 */
router.get(
  '/quotas',
  queryController.getQuotas.bind(queryController)
);

/**
 * @route   GET /api/subscription-service/v1/queries/logs
 * @desc    查询订阅操作日志（分页）
 * @access  User (JWT Token, userType=USER)
 */
router.get(
  '/logs',
  validate(GetLogsQuerySchema, 'query'),
  queryController.getLogs.bind(queryController)
);

export default router;
