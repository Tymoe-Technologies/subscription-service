import { Request, Response } from 'express';
import { webhookService } from '../services/webhook.service';
import { stripeService } from '../infra/stripe';
import { logger } from '../utils/logger';

export class WebhookController {

  async handleStripeWebhook(req: Request, res: Response): Promise<void> {
    const sig = req.headers['stripe-signature'] as string;

    if (!sig) {
      logger.error('Missing Stripe signature');
      res.status(400).send('Missing signature');
      return;
    }

    try {
      // Verify webhook signature and construct event
      const event = stripeService.verifyWebhookSignature(req.body.toString(), sig);

      // Process the event
      await webhookService.processStripeEvent(event);

      logger.info('Webhook processed successfully', {
        eventId: event.id,
        eventType: event.type
      });

      res.status(200).send('OK');
    } catch (error) {
      logger.error('Webhook processing failed', {
        error: error instanceof Error ? error.message : String(error)
      });

      if (error instanceof Error && error.message.includes('signature')) {
        res.status(400).send('Invalid signature');
        return;
      }

      res.status(500).send('Webhook processing failed');
    }
  }
}

export const webhookController = new WebhookController();