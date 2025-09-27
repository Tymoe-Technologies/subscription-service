import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { organizationService } from '../services/organization.service';
import { stripeService } from '../infra/stripe';
import { logger } from '../utils/logger';

export class OrganizationController {

  // POST /organizations/sync
  async syncOrganization(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { organizationId } = req.body;
      const { name } = req.body;

      if (!organizationId) {
        res.status(400).json({
          success: false,
          error: { code: 'missing_organization_id', message: 'Organization ID is required' }
        });
        return;
      }

      const organization = await organizationService.syncOrganizationIfNotExists({ id: organizationId, name: name || 'Organization' });

      res.json({
        success: true,
        data: organization
      });
    } catch (error) {
      logger.error('Organization sync failed', {
        error: error instanceof Error ? error.message : String(error),
        userId: req.user.userId
      });

      res.status(500).json({
        success: false,
        error: { code: 'sync_failed', message: 'Failed to sync organization' }
      });
    }
  }

  // PATCH /organizations/:id/stripe-customer
  async updateStripeCustomer(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id: organizationId } = req.params;
      const { name } = req.body;

      if (!organizationId) {
        res.status(400).json({
          success: false,
          error: { code: 'missing_organization_id', message: 'Organization ID is required' }
        });
        return;
      }

      const org = await organizationService.syncOrganizationIfNotExists(
        { id: organizationId, name: name || 'Organization' }
      );

      if (org.stripeCustomerId) {
        res.json({
          success: true,
          data: { stripeCustomerId: org.stripeCustomerId }
        });
        return;
      }

      // Create Stripe customer
      const customer = await stripeService.createCustomer({
        email: req.body.email || '',
        name: org.name,
        organizationId
      });

      // Update organization
      const updatedOrg = await organizationService.updateStripeCustomerId(
        organizationId,
        customer.id
      );

      res.json({
        success: true,
        data: { stripeCustomerId: updatedOrg.stripeCustomerId }
      });
    } catch (error) {
      logger.error('Stripe customer update failed', {
        error: error instanceof Error ? error.message : String(error),
        organizationId: req.params.id,
        userId: req.user.userId
      });

      res.status(500).json({
        success: false,
        error: { code: 'customer_update_failed', message: 'Failed to update Stripe customer' }
      });
    }
  }
}

export const organizationController = new OrganizationController();