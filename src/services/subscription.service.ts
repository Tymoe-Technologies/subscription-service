import { prisma } from '../infra/prisma';
import { logger } from '../utils/logger';
import { auditService } from './auditService';
import { organizationService } from './organization.service';
import { stripeService } from '../infra/stripe';
import { DEFAULT_REGION, DEFAULT_CURRENCY, getRegionCurrency, isValidRegion } from '../config/defaults';
import { SUBSCRIPTION_STATUS } from '../constants';

export class SubscriptionService {

  async createTrialSubscription(organizationId: string, productKey: string, userId: string) {
    try {
      // Validate product is trial using the isTrialProduct utility
      const { isTrialProduct } = await import('../constants/index.js');
      if (!isTrialProduct(productKey)) {
        throw new Error('Invalid trial product');
      }

      // Check if organization has already used trial
      const hasUsedTrial = await organizationService.checkOrganizationHasUsedTrial(organizationId);
      if (hasUsedTrial) {
        throw new Error('Trial already used');
      }

      // Check product exists
      const product = await prisma.product.findUnique({
        where: { key: productKey }
      });

      if (!product) {
        throw new Error('Product not found');
      }

      const now = new Date();
      const trialEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

      // Create trial subscription and mark organization as used trial
      const result = await prisma.$transaction(async (tx) => {
        const subscription = await tx.subscription.create({
          data: {
            organizationId,
            productKey,
            status: SUBSCRIPTION_STATUS.TRIALING,
            tier: 'trial',
            currentPeriodStart: now,
            currentPeriodEnd: trialEnd,
            trialEnd,
            version: 1
          },
          include: {
            organization: true,
            product: true
          }
        });

        // Mark organization as having used trial
        await tx.organization.update({
          where: { id: organizationId },
          data: { hasUsedTrial: true }
        });

        return subscription;
      });

      // Audit log
      await auditService.logSubscriptionChange(
        result.id,
        'CREATE',
        'USER',
        userId,
        {
          productKey,
          status: SUBSCRIPTION_STATUS.TRIALING,
          trialEnd: trialEnd.toISOString()
        }
      );

      logger.info('Trial subscription created', {
        subscriptionId: result.id,
        organizationId,
        productKey,
        trialEnd: trialEnd.toISOString()
      });

      return result;
    } catch (error) {
      logger.error('Failed to create trial subscription', {
        error: error instanceof Error ? error.message : String(error),
        organizationId,
        productKey
      });
      throw error;
    }
  }

  async createCheckoutSession({
    organizationId,
    productKey,
    targetTier,
    targetBillingCycle,
    successUrl,
    cancelUrl,
    customerId,
    region
  }: {
    organizationId: string;
    productKey: string;
    targetTier?: string;
    targetBillingCycle?: string;
    successUrl: string;
    cancelUrl: string;
    customerId?: string;
    region?: string;
  }) {
    try {
      // Use region and derive currency
      const normalizedRegion = region && isValidRegion(region) ? region : DEFAULT_REGION;
      const currency = getRegionCurrency(normalizedRegion);

      // Find price for the product with region filtering
      const whereClause: any = {
        productKey,
        region: normalizedRegion
      };
      if (targetTier) {
        whereClause.tier = targetTier;
      }
      if (targetBillingCycle) {
        whereClause.billingCycle = targetBillingCycle;
      }

      const price = await prisma.price.findFirst({
        where: whereClause
      });

      if (!price || !price.stripePriceId) {
        throw new Error('Price not found');
      }

      // Create Stripe checkout session
      const sessionParams = {
        priceId: price.stripePriceId,
        successUrl,
        cancelUrl,
        metadata: {
          organizationId,
          productKey,
          targetTier: targetTier || '',
          targetBillingCycle: targetBillingCycle || '',
          region: normalizedRegion,
          currency
        }
      } as any;

      if (customerId) {
        sessionParams.customerId = customerId;
      }

      const session = await stripeService.createCheckoutSession(sessionParams);

      return {
        checkoutUrl: session.url,
        sessionId: session.id
      };
    } catch (error) {
      logger.error('Failed to create checkout session', {
        error: error instanceof Error ? error.message : String(error),
        organizationId,
        productKey
      });
      throw error;
    }
  }

  async updateSubscriptionFromWebhook(stripeSubscription: any) {
    try {
      // Find existing subscription by Stripe ID
      let subscription = await prisma.subscription.findUnique({
        where: { stripeSubscriptionId: stripeSubscription.id }
      });

      if (!subscription) {
        // If no subscription found, try to find by organization and create new one
        const organizationId = stripeSubscription.metadata?.organizationId;
        const productKey = stripeSubscription.metadata?.productKey;

        if (!organizationId || !productKey) {
          throw new Error('Missing metadata in Stripe subscription');
        }

        subscription = await prisma.subscription.create({
          data: {
            organizationId,
            productKey,
            status: stripeSubscription.status,
            stripeSubscriptionId: stripeSubscription.id,
            stripePriceId: stripeSubscription.items?.data[0]?.price?.id,
            currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
            currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
            trialEnd: stripeSubscription.trial_end ? new Date(stripeSubscription.trial_end * 1000) : null,
            cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
            version: 1,
            lastSyncedAt: new Date()
          }
        });
      } else {
        // Update existing subscription with optimistic locking
        subscription = await prisma.subscription.update({
          where: {
            id: subscription.id,
            version: subscription.version
          },
          data: {
            status: stripeSubscription.status,
            stripePriceId: stripeSubscription.items?.data[0]?.price?.id,
            currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
            currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
            trialEnd: stripeSubscription.trial_end ? new Date(stripeSubscription.trial_end * 1000) : null,
            cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
            version: subscription.version + 1,
            lastSyncedAt: new Date()
          }
        });
      }

      logger.info('Subscription updated from webhook', {
        subscriptionId: subscription.id,
        stripeSubscriptionId: stripeSubscription.id,
        status: stripeSubscription.status
      });

      return subscription;
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as any).code === 'P2025') {
        // Version conflict, retry
        logger.warn('Subscription version conflict, retrying', {
          stripeSubscriptionId: stripeSubscription.id
        });
        // Could implement retry logic here
      }

      logger.error('Failed to update subscription from webhook', {
        error: error instanceof Error ? error.message : String(error),
        stripeSubscriptionId: stripeSubscription.id
      });
      throw error;
    }
  }

  async getSubscription(subscriptionId: string) {
    try {
      return await prisma.subscription.findUnique({
        where: { id: subscriptionId },
        include: {
          organization: true,
          product: true
        }
      });
    } catch (error) {
      logger.error('Failed to get subscription', {
        error: error instanceof Error ? error.message : String(error),
        subscriptionId
      });
      throw error;
    }
  }

  async getOrganizationSubscriptions(organizationId: string) {
    try {
      return await prisma.subscription.findMany({
        where: {
          organizationId,
          deletedAt: null
        },
        include: {
          product: true
        },
        orderBy: { createdAt: 'desc' }
      });
    } catch (error) {
      logger.error('Failed to get organization subscriptions', {
        error: error instanceof Error ? error.message : String(error),
        organizationId
      });
      throw error;
    }
  }

  isSubscriptionActive(subscription: any): boolean {
    if (!subscription || subscription.status === SUBSCRIPTION_STATUS.CANCELED) {
      return false;
    }

    const now = new Date();

    // Check trial period
    if (subscription.status === SUBSCRIPTION_STATUS.TRIALING) {
      return !subscription.trialEnd || subscription.trialEnd > now;
    }

    // Check grace period (highest priority)
    if (subscription.gracePeriodEnd) {
      return subscription.gracePeriodEnd > now;
    }

    // Check normal period
    if (subscription.currentPeriodEnd) {
      return subscription.currentPeriodEnd > now;
    }

    // Only active if status is ACTIVE
    return subscription.status === SUBSCRIPTION_STATUS.ACTIVE;
  }

  async getActiveSubscription(organizationId: string) {
    try {
      const subscriptions = await this.getOrganizationSubscriptions(organizationId);
      return subscriptions.find(sub => this.isSubscriptionActive(sub)) || null;
    } catch (error) {
      logger.error('Failed to get active subscription', {
        error: error instanceof Error ? error.message : String(error),
        organizationId
      });
      throw error;
    }
  }

  async getOrganizationFeatures(organizationId: string) {
    try {
      // Get active subscription
      const subscription = await this.getActiveSubscription(organizationId);

      if (!subscription) {
        return { level: null, features: {} };
      }

      // Get entitlements based on subscription tier
      const entitlements = await prisma.entitlement.findMany({
        where: { levelKey: subscription.tier || 'trial' },
        include: { feature: true }
      });

      // Build features object
      const features: Record<string, any> = {};
      for (const entitlement of entitlements) {
        features[entitlement.feature.key] = {
          isEnabled: entitlement.isEnabled,
          limit: entitlement.limit,
          unit: entitlement.feature.unit
        };
      }

      return {
        level: subscription.tier || 'trial',
        features
      };
    } catch (error) {
      logger.error('Failed to get organization features', {
        error: error instanceof Error ? error.message : String(error),
        organizationId
      });
      throw error;
    }
  }
}

export const subscriptionService = new SubscriptionService();