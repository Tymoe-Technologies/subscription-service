import { Router } from 'express';
import express from 'express';
import { handleStripeWebhook } from '../controllers/webhook.js';

const router = Router();

// Stripe webhook需要原始body，不能经过JSON解析
router.post('/stripe', express.raw({ type: 'application/json' }), handleStripeWebhook);

export default router;