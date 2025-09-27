import { Router, RequestHandler } from 'express';
import { adminController } from '../controllers/admin.controller';
import { validateInternalApiKey } from '../middleware/auth';

const router = Router();

// 所有 admin 路由都需要 API key 验证
router.use(validateInternalApiKey);

// POST /admin/subscriptions - 创建订阅 (仅维护模式)
router.post('/subscriptions', adminController.createSubscription.bind(adminController) as RequestHandler);

// GET /admin/subscriptions - 获取所有订阅
router.get('/subscriptions', adminController.getAllSubscriptions.bind(adminController) as RequestHandler);

// GET /admin/organizations - 获取所有组织
router.get('/organizations', adminController.getAllOrganizations.bind(adminController) as RequestHandler);

// GET /admin/webhook-events - 获取 webhook 事件
router.get('/webhook-events', adminController.getWebhookEvents.bind(adminController) as RequestHandler);

// GET /admin/audit-logs - 获取审计日志
router.get('/audit-logs', adminController.getAuditLogs.bind(adminController) as RequestHandler);

// GET /admin/stats - 获取统计数据
router.get('/stats', adminController.getStats.bind(adminController) as RequestHandler);

export { router as adminRoutes };