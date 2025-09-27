import { logger } from '../utils/logger';
import { subscriptionService } from './subscription.service';
import { subscriptionIntentService } from './subscriptionIntent.service';
import { auditService } from './auditService';
import { prisma } from '../infra/prisma';
import Stripe from 'stripe';

export class WebhookService {

  async processStripeEvent(event: Stripe.Event): Promise<void> {
    try {
      // Database-backed idempotency check using StripeEventProcessed table
      const existingEvent = await prisma.stripeEventProcessed.findUnique({
        where: { eventId: event.id }
      });

      if (existingEvent) {
        // Increment attempts counter for duplicate events
        await prisma.stripeEventProcessed.update({
          where: { eventId: event.id },
          data: { attempts: { increment: 1 } }
        });

        logger.info('Event already processed, skipping', {
          eventId: event.id,
          processedAt: existingEvent.processedAt,
          attempts: existingEvent.attempts + 1
        });
        return;
      }

      // Handle event by type
      await this.handleEventByType(event);

      // Mark as processed in database
      await prisma.stripeEventProcessed.create({
        data: {
          eventId: event.id,
          eventType: event.type,
          processed: true,
          attempts: 1,
          processedAt: new Date(),
        }
      });

      logger.info('Stripe event processed successfully', {
        eventId: event.id,
        eventType: event.type
      });

    } catch (error) {
      logger.error('Failed to process Stripe event', {
        eventId: event.id,
        eventType: event.type,
        error: error instanceof Error ? error.message : String(error)
      });

      throw error;
    }
  }

  private async handleEventByType(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await this.handleSubscriptionChange(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.payment_succeeded':
        await this.handlePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        await this.handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      default:
        logger.info('Unhandled event type', { eventType: event.type });
    }
  }

  private async handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    logger.info('Checkout completed', {
      sessionId: session.id,
      customerId: session.customer,
      subscriptionId: session.subscription
    });

    // Look for associated intent by checkout session ID
    const intent = await prisma.subscriptionIntent.findUnique({
      where: { stripeCheckoutId: session.id }
    });

    if (intent && session.subscription) {
      // Complete the intent with the subscription ID
      await subscriptionIntentService.completeIntent(
        intent.id,
        session.subscription as string
      );

      // Log audit trail
      await auditService.logIntentChange(
        intent.id,
        'UPDATE',
        'WEBHOOK',
        null,
        { checkoutCompleted: true, subscriptionId: session.subscription }
      );
    }

    // The actual subscription update will come via customer.subscription.created event
  }

  private async handleSubscriptionChange(subscription: Stripe.Subscription): Promise<void> {
    const updatedSubscription = await subscriptionService.updateSubscriptionFromWebhook(subscription);

    if (updatedSubscription) {
      await auditService.logSubscriptionChange(
        updatedSubscription.id,
        'UPDATE',
        'WEBHOOK',
        null,
        {
          stripeStatus: subscription.status,
          currentPeriodStart: subscription.current_period_start,
          currentPeriodEnd: subscription.current_period_end
        }
      );
    }
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    const updatedSubscription = await subscriptionService.updateSubscriptionFromWebhook({
      ...subscription,
      status: 'canceled'
    });

    if (updatedSubscription) {
      await auditService.logSubscriptionChange(
        updatedSubscription.id,
        'DELETE',
        'WEBHOOK',
        null,
        { stripeStatus: 'canceled', deletedAt: new Date() }
      );
    }
  }

  private async handlePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
    if (invoice.subscription) {
      logger.info('Payment succeeded, subscription should be active', {
        invoiceId: invoice.id,
        subscriptionId: invoice.subscription
      });
    }
  }

  private async handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    if (invoice.subscription) {
      logger.info('Payment failed, subscription should be past_due', {
        invoiceId: invoice.id,
        subscriptionId: invoice.subscription
      });
    }
  }
}

export const webhookService = new WebhookService();