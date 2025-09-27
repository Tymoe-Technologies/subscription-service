import { prisma } from '../infra/prisma';
import { logger } from '../utils/logger';
import { auditService } from './auditService';

export class OrganizationService {

  async syncOrganizationIfNotExists(payloadOrg: { id: string, name: string }, userId?: string) {
    try {
      // Check if organization exists
      const existing = await prisma.organization.findUnique({
        where: { id: payloadOrg.id }
      });

      if (existing) {
        return existing;
      }

      // Create new organization - userId is optional for migration compatibility
      const organization = await prisma.organization.create({
        data: {
          id: payloadOrg.id,
          name: payloadOrg.name,
          userId: userId || null,
          hasUsedTrial: false
        }
      });

      logger.info('Organization created', {
        organizationId: organization.id,
        userId: userId || 'migration'
      });

      return organization;
    } catch (error) {
      logger.error('Failed to sync organization', {
        error: error instanceof Error ? error.message : String(error),
        orgId: payloadOrg.id,
        userId
      });
      throw error;
    }
  }

  async checkOrganizationHasUsedTrial(organizationId: string): Promise<boolean> {
    try {
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { hasUsedTrial: true }
      });

      return organization?.hasUsedTrial || false;
    } catch (error) {
      logger.error('Failed to check organization trial status', {
        error: error instanceof Error ? error.message : String(error),
        organizationId
      });
      return false;
    }
  }

  async updateStripeCustomerId(organizationId: string, stripeCustomerId: string) {
    try {
      const organization = await prisma.organization.update({
        where: { id: organizationId },
        data: { stripeCustomerId }
      });

      logger.info('Stripe customer ID updated', {
        organizationId,
        stripeCustomerId
      });

      return organization;
    } catch (error) {
      logger.error('Failed to update stripe customer ID', {
        error: error instanceof Error ? error.message : String(error),
        organizationId,
        stripeCustomerId
      });
      throw error;
    }
  }

  async markTrialUsed(organizationId: string) {
    try {
      const organization = await prisma.organization.update({
        where: { id: organizationId },
        data: { hasUsedTrial: true }
      });

      await auditService.logOrganizationChange(
        organizationId,
        'UPDATE',
        'SYSTEM',
        null,
        { hasUsedTrial: { from: false, to: true } }
      );

      logger.info('Organization trial status marked as used', {
        organizationId
      });

      return organization;
    } catch (error) {
      logger.error('Failed to mark trial as used', {
        error: error instanceof Error ? error.message : String(error),
        organizationId
      });
      throw error;
    }
  }

  async getOrganizationById(organizationId: string) {
    try {
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        include: {
          subscriptions: {
            include: {
              product: true
            }
          }
        }
      });

      return organization;
    } catch (error) {
      logger.error('Failed to get organization', {
        error: error instanceof Error ? error.message : String(error),
        organizationId
      });
      throw error;
    }
  }
}

export const organizationService = new OrganizationService();