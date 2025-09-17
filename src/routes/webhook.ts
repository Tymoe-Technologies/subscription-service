import { Router } from 'express';
import express from 'express';
import { handleStripeWebhook } from '../controllers/webhook.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// Stripe webhook需要原始body，不能经过JSON解析
router.post('/stripe', express.raw({ type: 'application/json' }), asyncHandler(handleStripeWebhook));

export default router;
