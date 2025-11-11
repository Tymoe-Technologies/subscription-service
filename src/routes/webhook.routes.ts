import { Router } from 'express';
import { webhookController } from '../controllers/webhook.controller.js';

/**
 * Part 5: Webhook Routes
 * 支付商Webhook路由
 *
 * 特点：
 * - 无需JWT认证（使用签名验证）
 * - 需要raw body（已在app.ts中配置）
 * - 支持多支付商扩展（stripe/paypal）
 */
const router = Router();

/**
 * @route   POST /webhooks/stripe
 * @desc    Stripe Webhook处理器
 * @auth    Stripe Signature Verification
 *
 * 支持的事件类型（12个）：
 * 1. checkout.session.completed - 结账完成
 * 2. customer.subscription.created - 订阅创建
 * 3. customer.subscription.updated - 订阅更新
 * 4. customer.subscription.deleted - 订阅删除
 * 5. invoice.created - 发票创建
 * 6. invoice.finalized - 发票确定
 * 7. invoice.payment_succeeded - 支付成功
 * 8. invoice.payment_failed - 支付失败
 * 9. payment_method.attached - 支付方式绑定
 * 10. payment_method.detached - 支付方式解绑
 * 11. charge.refunded - 退款
 * 12. customer.updated - 客户更新
 */
router.post('/stripe', webhookController.handleStripeWebhook.bind(webhookController));

// 未来可以添加其他支付商
// router.post('/paypal', webhookController.handlePayPalWebhook.bind(webhookController));

export { router as webhookRoutes };
