import { Router, RequestHandler } from 'express';
import { subscriptionController } from '../controllers/subscription.controller';
import { verifyJwtMiddleware } from '../middleware/auth';

const router = Router();

// Create subscription (trial or paid)
router.post('/', verifyJwtMiddleware, subscriptionController.createSubscription.bind(subscriptionController) as unknown as RequestHandler);

// Create intent for paid subscriptions
router.post('/intent', verifyJwtMiddleware, subscriptionController.createIntent.bind(subscriptionController) as unknown as RequestHandler);

// Create checkout session
router.post('/checkout', verifyJwtMiddleware, subscriptionController.createCheckoutSession.bind(subscriptionController) as unknown as RequestHandler);

// Get subscription
router.get('/:id', verifyJwtMiddleware, subscriptionController.getSubscription.bind(subscriptionController) as unknown as RequestHandler);

// Subscription lifecycle operations
router.post('/:id/upgrade', verifyJwtMiddleware, subscriptionController.upgradeSubscription.bind(subscriptionController) as unknown as RequestHandler);

router.post('/:id/cancel', verifyJwtMiddleware, subscriptionController.cancelSubscription.bind(subscriptionController) as unknown as RequestHandler);

router.post('/:id/reactivate', verifyJwtMiddleware, subscriptionController.reactivateSubscription.bind(subscriptionController) as unknown as RequestHandler);

export { router as subscriptionRoutes };