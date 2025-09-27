import { prisma } from '../infra/prisma.js';
import { logger } from '../utils/logger.js';
import { auditService } from './auditService.js';
import { stripe } from '../infra/stripe.js';
import { SUBSCRIPTION_INTENT_STATUS, SUBSCRIPTION_INTENT_ACTION } from '../constants';
import { DEFAULT_REGION, DEFAULT_CURRENCY, getRegionCurrency } from '../config/defaults';

export interface CreateIntentRequest {
  organizationId: string;
  productKey: string;
  action: string;
  stripePriceId?: string;
  region?: string;
  metadata?: Record<string, any>;
}

export interface IntentResponse {
  id: string;
  status: string;
  checkoutUrl?: string | undefined;
  expiresAt: Date;
}

export class SubscriptionIntentService {

  async createIntent(request: CreateIntentRequest): Promise<IntentResponse> {
    try {
      // Validate action
      if (!Object.values(SUBSCRIPTION_INTENT_ACTION).includes(request.action as any)) {
        throw new Error(`Invalid action: ${request.action}`);
      }

      // Check for existing pending intents for the same org/product
      const existingIntent = await prisma.subscriptionIntent.findFirst({
        where: {
          organizationId: request.organizationId,
          productKey: request.productKey,
          status: SUBSCRIPTION_INTENT_STATUS.PENDING,
          expiresAt: {
            gt: new Date()
          }
        }
      });

      if (existingIntent) {
        logger.info('Returning existing pending intent', {
          intentId: existingIntent.id,
          organizationId: request.organizationId,
          productKey: request.productKey
        });

        return {
          id: existingIntent.id,
          status: existingIntent.status,
          checkoutUrl: existingIntent.stripeCheckoutId ? `https://checkout.stripe.com/pay/${existingIntent.stripeCheckoutId}` : undefined,
          expiresAt: existingIntent.expiresAt
        };
      }

      // Create new intent with 1 hour expiration
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      const region = request.region || DEFAULT_REGION;
      const currency = getRegionCurrency(region as keyof typeof import('../config/defaults').SUPPORTED_REGIONS);

      const intent = await prisma.subscriptionIntent.create({
        data: {
          organizationId: request.organizationId,
          productKey: request.productKey,
          action: request.action,
          status: SUBSCRIPTION_INTENT_STATUS.PENDING,
          stripePriceId: request.stripePriceId || null,
          metadata: {
            ...request.metadata || {},
            region,
            currency
          },
          expiresAt
        }
      });

      // Create Stripe checkout session for CHECKOUT actions
      let checkoutUrl: string | undefined;
      if (request.action === SUBSCRIPTION_INTENT_ACTION.CHECKOUT && request.stripePriceId) {
        const checkoutSession = await stripe.checkout.sessions.create({
          mode: 'subscription',
          line_items: [
            {
              price: request.stripePriceId,
              quantity: 1
            }
          ],
          success_url: process.env.STRIPE_SUCCESS_URL || 'https://tymoe.com/success?session_id={CHECKOUT_SESSION_ID}',
          cancel_url: process.env.STRIPE_CANCEL_URL || 'https://tymoe.com/cancel',
          metadata: {
            intentId: intent.id,
            organizationId: request.organizationId,
            productKey: request.productKey,
            region,
            currency
          },
          currency: currency ? currency.toLowerCase() : 'cad',
          expires_at: Math.floor(expiresAt.getTime() / 1000)
        });

        // Update intent with checkout session ID
        await prisma.subscriptionIntent.update({
          where: { id: intent.id },
          data: { stripeCheckoutId: checkoutSession.id }
        });

        checkoutUrl = checkoutSession.url || undefined;
      }

      await auditService.logIntentChange(
        intent.id,
        'CREATE',
        'USER',
        null,
        { action: request.action, productKey: request.productKey }
      );

      logger.info('Subscription intent created', {
        intentId: intent.id,
        organizationId: request.organizationId,
        productKey: request.productKey,
        action: request.action
      });

      return {
        id: intent.id,
        status: intent.status,
        checkoutUrl,
        expiresAt: intent.expiresAt
      };
    } catch (error) {
      logger.error('Failed to create subscription intent', {
        error: error instanceof Error ? error.message : String(error),
        request
      });
      throw error;
    }
  }

  async getIntent(intentId: string) {
    try {
      const intent = await prisma.subscriptionIntent.findUnique({
        where: { id: intentId }
      });

      if (!intent) {
        throw new Error('Intent not found');
      }

      return intent;
    } catch (error) {
      logger.error('Failed to get intent', {
        error: error instanceof Error ? error.message : String(error),
        intentId
      });
      throw error;
    }
  }

  async updateIntentStatus(intentId: string, status: string, stripeSubscriptionId?: string) {
    try {
      // 先获取当前版本号实现乐观锁
      const currentIntent = await prisma.subscriptionIntent.findUnique({
        where: { id: intentId }
      });

      if (!currentIntent) {
        throw new Error('Intent not found');
      }

      const intent = await prisma.subscriptionIntent.update({
        where: {
          id: intentId,
          version: currentIntent.version // 乐观锁
        },
        data: {
          status,
          stripeSubscriptionId: stripeSubscriptionId || null,
          version: currentIntent.version + 1 // 增加版本号
        }
      });

      await auditService.logIntentChange(
        intentId,
        'UPDATE',
        'SYSTEM',
        null,
        { status: { to: status }, stripeSubscriptionId }
      );

      logger.info('Intent status updated', {
        intentId,
        status,
        stripeSubscriptionId
      });

      return intent;
    } catch (error) {
      // 检查是否是乐观锁冲突
      if (error instanceof Error && 'code' in error && (error as any).code === 'P2025') {
        logger.warn('Intent version conflict detected, retrying', {
          intentId,
          status,
          error: error.message
        });

        // 可以在这里实现重试逻辑，或者抛出特定的错误让调用方处理
        throw new Error(`Intent version conflict - another process may have updated this intent: ${intentId}`);
      }

      logger.error('Failed to update intent status', {
        error: error instanceof Error ? error.message : String(error),
        intentId,
        status
      });
      throw error;
    }
  }

  async completeIntent(intentId: string, stripeSubscriptionId: string) {
    try {
      return await this.updateIntentStatus(intentId, SUBSCRIPTION_INTENT_STATUS.COMPLETED, stripeSubscriptionId);
    } catch (error) {
      logger.error('Failed to complete intent', {
        error: error instanceof Error ? error.message : String(error),
        intentId
      });
      throw error;
    }
  }

  async failIntent(intentId: string, reason?: string) {
    try {
      const intent = await this.updateIntentStatus(intentId, SUBSCRIPTION_INTENT_STATUS.FAILED);

      // Record failure reason in metadata if provided
      if (reason) {
        await auditService.logIntentChange(
          intentId,
          'UPDATE',
          'SYSTEM',
          null,
          { status: { to: SUBSCRIPTION_INTENT_STATUS.FAILED }, failureReason: reason }
        );
      }

      logger.info('Intent failed', {
        intentId,
        reason
      });

      return intent;
    } catch (error) {
      logger.error('Failed to fail intent', {
        error: error instanceof Error ? error.message : String(error),
        intentId,
        reason
      });
      throw error;
    }
  }

  async expireOldIntents() {
    try {
      const result = await prisma.subscriptionIntent.updateMany({
        where: {
          status: SUBSCRIPTION_INTENT_STATUS.PENDING,
          expiresAt: {
            lt: new Date()
          }
        },
        data: {
          status: SUBSCRIPTION_INTENT_STATUS.EXPIRED
        }
      });

      logger.info('Expired old subscription intents', {
        expiredCount: result.count
      });

      return result.count;
    } catch (error) {
      logger.error('Failed to expire old intents', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async getOrganizationIntents(organizationId: string, limit: number = 50) {
    try {
      const intents = await prisma.subscriptionIntent.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        take: limit
      });

      return intents;
    } catch (error) {
      logger.error('Failed to get organization intents', {
        error: error instanceof Error ? error.message : String(error),
        organizationId
      });
      throw error;
    }
  }
}

export const subscriptionIntentService = new SubscriptionIntentService();