import { Router } from 'express';
import { webhookController } from '../controllers/webhook.controller';

const router = Router();

// Stripe webhook (no auth middleware, uses signature verification)
router.post('/stripe', webhookController.handleStripeWebhook.bind(webhookController));

export { router as webhookRoutes };