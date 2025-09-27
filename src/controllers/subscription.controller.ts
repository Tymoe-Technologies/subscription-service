import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../types/index.js';
import { subscriptionService } from '../services/subscription.service';
import { organizationService } from '../services/organization.service';
import { subscriptionIntentService } from '../services/subscriptionIntent.service';
import { logger } from '../utils/logger';
import { SUBSCRIPTION_INTENT_ACTION } from '../constants';

export class SubscriptionController {

  // POST /subscriptions
  async createSubscription(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { organizationId, productKey } = req.body;
      const userId = req.user.id;

      if (!organizationId || !productKey) {
        res.status(400).json({
          success: false,
          error: { code: 'missing_fields', message: 'organizationId and productKey are required' }
        });
        return;
      }

      // Sync organization first
      await organizationService.syncOrganizationIfNotExists(
        { id: organizationId, name: req.body.name || 'Organization' }
      );

      // Check if product is trial using our utility function
      const { isTrialProduct } = await import('../constants/index.js');
      if (isTrialProduct(productKey)) {
        // Create trial subscription
        const subscription = await subscriptionService.createTrialSubscription(
          organizationId,
          productKey,
          userId
        );

        res.json({
          success: true,
          data: subscription
        });
      } else {
        // For paid subscriptions, return that requires payment
        res.json({
          success: true,
          data: {
            requiresPayment: true,
            message: 'Use /subscriptions/intent for paid subscriptions'
          }
        });
      }
    } catch (error) {
      logger.error('Subscription creation failed', {
        error: error instanceof Error ? error.message : String(error),
        organizationId: req.body.organizationId,
        productKey: req.body.productKey,
        userId: req.user.id
      });

      const statusCode = error instanceof Error && error.message === 'Trial already used' ? 409 : 500;

      res.status(statusCode).json({
        success: false,
        error: {
          code: statusCode === 409 ? 'trial_already_used' : 'creation_failed',
          message: error instanceof Error ? error.message : 'Failed to create subscription'
        }
      });
    }
  }

  // POST /subscriptions/intent
  async createIntent(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const {
        organizationId,
        productKey,
        targetTier,
        targetBillingCycle,
        successUrl,
        cancelUrl
      } = req.body;
      const userId = req.user.id;

      if (!organizationId || !productKey) {
        res.status(400).json({
          success: false,
          error: { code: 'missing_fields', message: 'organizationId and productKey are required' }
        });
        return;
      }

      // Sync organization and ensure stripe customer exists
      const org = await organizationService.syncOrganizationIfNotExists(
        { id: organizationId, name: req.body.name || 'Organization' }
      );

      let customerId = org.stripeCustomerId;
      if (!customerId) {
        // This should be handled by the organization controller first
        res.status(400).json({
          success: false,
          error: { code: 'missing_customer', message: 'Stripe customer not found' }
        });
        return;
      }

      const result = await subscriptionService.createCheckoutSession({
        organizationId,
        productKey,
        targetTier,
        targetBillingCycle,
        successUrl,
        cancelUrl,
        customerId,
        region: req.body.region
      });

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Intent creation failed', {
        error: error instanceof Error ? error.message : String(error),
        organizationId: req.body.organizationId,
        productKey: req.body.productKey,
        userId: req.user.id
      });

      res.status(500).json({
        success: false,
        error: { code: 'intent_failed', message: 'Failed to create checkout session' }
      });
    }
  }

  // GET /subscriptions/:id
  async getSubscription(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(400).json({
          success: false,
          error: { code: 'missing_id', message: 'Subscription ID is required' }
        });
        return;
      }

      const subscription = await subscriptionService.getSubscription(id);

      if (!subscription) {
        res.status(404).json({
          success: false,
          error: { code: 'not_found', message: 'Subscription not found' }
        });
        return;
      }

      res.json({
        success: true,
        data: subscription
      });
    } catch (error) {
      logger.error('Get subscription failed', {
        error: error instanceof Error ? error.message : String(error),
        subscriptionId: req.params.id
      });

      res.status(500).json({
        success: false,
        error: { code: 'get_failed', message: 'Failed to get subscription' }
      });
    }
  }

  // POST /subscriptions/:id/upgrade
  async upgradeSubscription(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { targetTier, targetBillingCycle, stripePriceId } = req.body;

      if (!id || !targetTier || !stripePriceId) {
        res.status(400).json({
          success: false,
          error: { code: 'missing_fields', message: 'id, targetTier, and stripePriceId are required' }
        });
        return;
      }

      // Get existing subscription
      const subscription = await subscriptionService.getSubscription(id);
      if (!subscription) {
        res.status(404).json({
          success: false,
          error: { code: 'not_found', message: 'Subscription not found' }
        });
        return;
      }

      // Create upgrade intent
      const intent = await subscriptionIntentService.createIntent({
        organizationId: subscription.organizationId,
        productKey: subscription.productKey,
        action: SUBSCRIPTION_INTENT_ACTION.UPGRADE,
        stripePriceId,
        metadata: {
          subscriptionId: id,
          targetTier,
          targetBillingCycle,
          currentTier: subscription.tier
        }
      });

      res.json({
        success: true,
        data: intent
      });
    } catch (error) {
      logger.error('Subscription upgrade failed', {
        error: error instanceof Error ? error.message : String(error),
        subscriptionId: req.params.id
      });

      res.status(500).json({
        success: false,
        error: { code: 'upgrade_failed', message: 'Failed to upgrade subscription' }
      });
    }
  }

  // POST /subscriptions/:id/cancel
  async cancelSubscription(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { cancelAtPeriodEnd = true, reason } = req.body;

      if (!id) {
        res.status(400).json({
          success: false,
          error: { code: 'missing_id', message: 'Subscription ID is required' }
        });
        return;
      }

      // Get existing subscription
      const subscription = await subscriptionService.getSubscription(id);
      if (!subscription) {
        res.status(404).json({
          success: false,
          error: { code: 'not_found', message: 'Subscription not found' }
        });
        return;
      }

      // Create cancel intent
      const intent = await subscriptionIntentService.createIntent({
        organizationId: subscription.organizationId,
        productKey: subscription.productKey,
        action: SUBSCRIPTION_INTENT_ACTION.CANCEL,
        metadata: {
          subscriptionId: id,
          cancelAtPeriodEnd,
          reason,
          userId: req.user.id
        }
      });

      res.json({
        success: true,
        data: intent
      });
    } catch (error) {
      logger.error('Subscription cancellation failed', {
        error: error instanceof Error ? error.message : String(error),
        subscriptionId: req.params.id
      });

      res.status(500).json({
        success: false,
        error: { code: 'cancel_failed', message: 'Failed to cancel subscription' }
      });
    }
  }

  // POST /subscriptions/:id/reactivate
  async reactivateSubscription(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(400).json({
          success: false,
          error: { code: 'missing_id', message: 'Subscription ID is required' }
        });
        return;
      }

      // Get existing subscription
      const subscription = await subscriptionService.getSubscription(id);
      if (!subscription) {
        res.status(404).json({
          success: false,
          error: { code: 'not_found', message: 'Subscription not found' }
        });
        return;
      }

      // Create reactivate intent
      const intent = await subscriptionIntentService.createIntent({
        organizationId: subscription.organizationId,
        productKey: subscription.productKey,
        action: SUBSCRIPTION_INTENT_ACTION.REACTIVATE,
        metadata: {
          subscriptionId: id,
          userId: req.user.id
        }
      });

      res.json({
        success: true,
        data: intent
      });
    } catch (error) {
      logger.error('Subscription reactivation failed', {
        error: error instanceof Error ? error.message : String(error),
        subscriptionId: req.params.id
      });

      res.status(500).json({
        success: false,
        error: { code: 'reactivate_failed', message: 'Failed to reactivate subscription' }
      });
    }
  }

  // POST /subscriptions/checkout
  async createCheckoutSession(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { organizationId, productKey, stripePriceId, successUrl, cancelUrl } = req.body;

      if (!organizationId || !productKey || !stripePriceId) {
        res.status(400).json({
          success: false,
          error: { code: 'missing_fields', message: 'organizationId, productKey, and stripePriceId are required' }
        });
        return;
      }

      // Sync organization first
      await organizationService.syncOrganizationIfNotExists(
        { id: organizationId, name: req.body.name || 'Organization' },
        req.user.id
      );

      // Create checkout intent
      const intent = await subscriptionIntentService.createIntent({
        organizationId,
        productKey,
        action: SUBSCRIPTION_INTENT_ACTION.CHECKOUT,
        stripePriceId,
        region: req.body.region,
        metadata: {
          userId: req.user.id,
          successUrl,
          cancelUrl
        }
      });

      res.json({
        success: true,
        data: intent
      });
    } catch (error) {
      logger.error('Checkout session creation failed', {
        error: error instanceof Error ? error.message : String(error),
        organizationId: req.body.organizationId,
        productKey: req.body.productKey
      });

      res.status(500).json({
        success: false,
        error: { code: 'checkout_failed', message: 'Failed to create checkout session' }
      });
    }
  }
}

export const subscriptionController = new SubscriptionController();