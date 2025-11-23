import { Request, Response, NextFunction } from 'express';
import Stripe from 'stripe';
import { stripe } from '../../../infra/stripe.js';
import { service } from '../../../config/config.js';
import { webhookService } from './webhookService.js';
import { logger } from '../../../utils/logger.js';
import { AppError } from '../../../utils/errors.js';

/**
 * Webhook 控制器
 * 处理 Stripe Webhook 请求
 */
export class WebhookController {
  /**
   * 处理 Stripe Webhook
   * POST /api/subscription-service/v1/webhooks/stripe
   *
   * 注意：此端点需要 raw body，不能使用 JSON parser
   */
  handleStripeWebhook = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      // 1. 获取 Stripe 签名
      const signature = req.headers['stripe-signature'] as string;

      if (!signature) {
        logger.warn('Stripe Webhook 签名缺失');
        res.status(400).json({
          success: false,
          error: 'missing_signature',
          detail: 'Stripe-Signature header is required',
        });
        return;
      }

      // 2. 验证签名并解析事件
      let event: Stripe.Event;

      try {
        // req.body 应该是 raw buffer（在路由中配置）
        const rawBody = req.body;
        const webhookSecret = service.stripe.webhookSecret;

        if (!webhookSecret) {
          logger.error('Stripe Webhook Secret 未配置');
          throw new AppError(
            'server_error',
            'Stripe Webhook Secret is not configured',
            500
          );
        }

        event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        logger.warn('Stripe Webhook 签名验证失败', { error: message });
        res.status(400).json({
          success: false,
          error: 'invalid_signature',
          detail: `Webhook signature verification failed: ${message}`,
        });
        return;
      }

      logger.info('Stripe Webhook 签名验证成功', {
        eventId: event.id,
        eventType: event.type,
      });

      // 3. 处理事件
      const result = await webhookService.processEvent(event);

      // 4. 返回成功响应（Stripe 需要 2xx 响应）
      res.status(200).json({
        received: true,
        eventId: result.eventId,
        eventType: result.eventType,
        message: result.message,
      });
    } catch (error) {
      // 记录错误但仍返回 200（避免 Stripe 重试）
      // 如果返回非 2xx，Stripe 会持续重试，可能导致问题
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Webhook 处理异常', { error: errorMessage });

      // 根据错误类型决定响应
      // 对于可恢复的错误，返回 500 让 Stripe 重试
      // 对于不可恢复的错误（如数据问题），返回 200 避免无限重试
      if (error instanceof AppError && error.statusCode >= 500) {
        res.status(500).json({
          received: false,
          error: 'processing_error',
          detail: errorMessage,
        });
      } else {
        // 返回 200 但记录错误
        res.status(200).json({
          received: true,
          warning: 'Event received but processing had issues',
          error: errorMessage,
        });
      }
    }
  };
}

export const webhookController = new WebhookController();
