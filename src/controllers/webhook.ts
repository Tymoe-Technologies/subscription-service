import { Request, Response } from 'express';
import { stripeService } from '../infra/stripe.js';
import { subscriptionService } from '../services/subscription.js';
import { logger } from '../utils/logger.js';

// 处理Stripe Webhook
export async function handleStripeWebhook(req: Request, res: Response): Promise<void> {
  const sig = req.headers['stripe-signature'] as string;

  if (!sig) {
    res.status(400).json({
      error: 'bad_request',
      message: '缺少Stripe签名',
    });
    return;
  }

  try {
    // 验证webhook签名
    const event = stripeService.verifyWebhookSignature(req.body, sig);

    logger.info(`收到Stripe webhook事件: ${event.type}`);

    // 处理webhook事件
    await subscriptionService.handleStripeWebhook(event as unknown as Record<string, unknown>);

    res.json({ received: true });
  } catch (error: unknown) {
    logger.error('处理Stripe webhook失败:', error);

    if (error instanceof Error ? error.message : String(error)?.includes('signature')) {
      res.status(400).json({
        error: 'invalid_signature',
        message: 'Webhook签名验证失败',
      });
      return;
    }

    res.status(500).json({
      error: 'server_error',
      message: '处理webhook失败',
    });
  }
}
