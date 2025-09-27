import { Router, RequestHandler } from 'express';
import { organizationController } from '../controllers/organization.controller';
import { verifyJwtMiddleware } from '../middleware/auth';

const router = Router();

// Organization sync
router.post('/sync', verifyJwtMiddleware, organizationController.syncOrganization.bind(organizationController) as unknown as RequestHandler);

// Stripe customer management
router.patch('/:id/stripe-customer', verifyJwtMiddleware, organizationController.updateStripeCustomer.bind(organizationController) as unknown as RequestHandler);

export { router as organizationRoutes };