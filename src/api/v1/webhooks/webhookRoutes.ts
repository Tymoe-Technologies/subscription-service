import { Router } from 'express';
import { webhookController } from './webhookController.js';

const router = Router();

/**
 * Webhook API 路由
 * 基础路径: /api/subscription-service/v1/webhooks
 *
 * 注意：Stripe Webhook 需要 raw body，不能使用 JSON parser
 * 这在 app.ts 中单独配置
 */

/**
 * POST /stripe
 * 处理 Stripe Webhook 事件
 *
 * Stripe 签名验证需要原始请求体（Buffer），
 * 因此这个路由不使用 express.json() 中间件
 */
router.post('/stripe', webhookController.handleStripeWebhook);

export default router;
