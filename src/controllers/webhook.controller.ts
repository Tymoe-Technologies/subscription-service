import { Request, Response } from 'express';
import { webhookService } from '../services/webhook.service.js';
import { stripeService } from '../infra/stripe.js';
import { logger } from '../utils/logger.js';

/**
 * Part 5: Webhook Controller
 * 处理支付商Webhook请求
 */
export class WebhookController {

  /**
   * 处理Stripe Webhook
   * POST /webhooks/stripe
   *
   * 特点：
   * 1. 签名验证（Stripe推荐）
   * 2. 幂等性保证（数据库去重）
   * 3. 异步处理（快速响应）
   * 4. 完整日志（审计追踪）
   */
  async handleStripeWebhook(req: Request, res: Response): Promise<void> {
    const sig = req.headers['stripe-signature'] as string;

    // 1. 验证签名
    if (!sig) {
      logger.error('Missing Stripe signature header', {
        path: req.path,
        ip: req.ip,
        headers: Object.keys(req.headers)
      });
      res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_SIGNATURE',
          message: 'Missing Stripe signature header'
        }
      });
      return;
    }

    try {
      // 2. 验证并构造事件
      const event = stripeService.verifyWebhookSignature(req.body.toString(), sig);

      logger.info('Received Stripe webhook', {
        eventId: event.id,
        eventType: event.type,
        livemode: event.livemode
      });

      // 3. 异步处理事件（不阻塞响应）
      // 这样Stripe会快速收到200响应
      webhookService.processStripeEvent(event)
        .catch((error) => {
          logger.error('Webhook processing failed (async)', {
            eventId: event.id,
            eventType: event.type,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          });
        });

      // 4. 立即返回成功（Stripe要求）
      res.status(200).json({
        success: true,
        message: 'Webhook received',
        eventId: event.id
      });

    } catch (error: any) {
      logger.error('Webhook verification or processing failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        path: req.path,
        ip: req.ip
      });

      // 签名验证失败
      if (error.message && error.message.includes('signature')) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_SIGNATURE',
            message: 'Invalid Stripe signature'
          }
        });
        return;
      }

      // 其他错误
      res.status(500).json({
        success: false,
        error: {
          code: 'WEBHOOK_ERROR',
          message: 'Webhook processing error'
        }
      });
    }
  }
}

export const webhookController = new WebhookController();
