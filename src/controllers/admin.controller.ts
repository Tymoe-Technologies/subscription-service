import { Request, Response } from 'express';
import { prisma } from '../infra/prisma';
import { logger } from '../utils/logger';
import { SUBSCRIPTION_STATUS, AUDIT_ENTITY_TYPE, AUDIT_ACTION, AUDIT_ACTOR_TYPE } from '../constants';
import { auditService } from '../services/auditService';

export class AdminController {

  // Middleware to check maintenance mode for admin operations
  private checkMaintenanceMode(req: Request, res: Response): boolean {
    const maintenanceMode = process.env.ADMIN_MAINTENANCE_MODE === 'true';
    if (!maintenanceMode) {
      logger.warn('Admin operation attempted without maintenance mode', {
        endpoint: req.path,
        method: req.method,
        ip: req.ip
      });
      res.status(403).json({
        success: false,
        error: {
          code: 'maintenance_mode_required',
          message: 'Admin operations require ADMIN_MAINTENANCE_MODE=true'
        }
      });
      return false;
    }
    return true;
  }

  // POST /admin/subscriptions - 创建订阅 (仅维护模式)
  async createSubscription(req: Request, res: Response): Promise<void> {
    if (!this.checkMaintenanceMode(req, res)) {
      return;
    }

    try {
      const {
        organizationId,
        productKey,
        status,
        tier,
        billingCycle,
        startDate,
        endDate,
        currentPeriodStart,
        currentPeriodEnd,
        trialEnd,
        reason,
        ticketId
      } = req.body;

      // Validate required fields
      if (!organizationId || !productKey || !status) {
        res.status(400).json({
          success: false,
          error: {
            code: 'invalid_request',
            message: 'organizationId, productKey, and status are required'
          }
        });
        return;
      }

      // Validate status enum
      if (!Object.values(SUBSCRIPTION_STATUS).includes(status)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'invalid_status',
            message: `Status must be one of: ${Object.values(SUBSCRIPTION_STATUS).join(', ')}`
          }
        });
        return;
      }

      // Check if organization exists
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId }
      });

      if (!organization) {
        res.status(404).json({
          success: false,
          error: {
            code: 'organization_not_found',
            message: 'Organization not found'
          }
        });
        return;
      }

      // Check if product exists
      const product = await prisma.product.findUnique({
        where: { key: productKey }
      });

      if (!product) {
        res.status(404).json({
          success: false,
          error: {
            code: 'product_not_found',
            message: 'Product not found'
          }
        });
        return;
      }

      // Create subscription
      const subscription = await prisma.subscription.create({
        data: {
          organizationId,
          productKey,
          status,
          tier,
          billingCycle,
          startDate: startDate ? new Date(startDate) : new Date(),
          endDate: endDate ? new Date(endDate) : null,
          currentPeriodStart: currentPeriodStart ? new Date(currentPeriodStart) : new Date(),
          currentPeriodEnd: currentPeriodEnd ? new Date(currentPeriodEnd) : null,
          trialEnd: trialEnd ? new Date(trialEnd) : null,
          version: 1
        },
        include: {
          organization: true,
          product: true
        }
      });

      // Log audit entry
      await auditService.logSubscriptionChange(
        subscription.id,
        AUDIT_ACTION.CREATE,
        AUDIT_ACTOR_TYPE.ADMIN,
        'admin-user', // This should be extracted from auth context
        {
          organizationId,
          productKey,
          status,
          tier,
          reason: reason || 'Manual admin creation',
          ticketId: ticketId || null
        }
      );

      logger.info('Subscription created via admin API', {
        subscriptionId: subscription.id,
        organizationId,
        productKey,
        status,
        reason,
        ticketId
      });

      res.status(201).json({
        success: true,
        data: { subscription }
      });

    } catch (error) {
      logger.error('Admin create subscription failed', {
        error: error instanceof Error ? error.message : String(error),
        body: req.body
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'admin_operation_failed',
          message: 'Failed to create subscription'
        }
      });
    }
  }

  // GET /admin/subscriptions - 获取所有订阅
  async getAllSubscriptions(req: Request, res: Response): Promise<void> {
    try {
      const { limit = 50, offset = 0 } = req.query;
      const subscriptions = await prisma.subscription.findMany({
        take: Number(limit),
        skip: Number(offset),
        include: {
          organization: true,
          product: true
        },
        orderBy: { createdAt: 'desc' }
      });

      const total = await prisma.subscription.count();

      res.json({
        success: true,
        data: {
          subscriptions,
          pagination: {
            total,
            limit: Number(limit),
            offset: Number(offset)
          }
        }
      });
    } catch (error) {
      logger.error('Admin get all subscriptions failed', {
        error: error instanceof Error ? error.message : String(error)
      });

      res.status(500).json({
        success: false,
        error: { code: 'admin_query_failed', message: 'Failed to query subscriptions' }
      });
    }
  }

  // GET /admin/organizations - 获取所有组织
  async getAllOrganizations(req: Request, res: Response): Promise<void> {
    try {
      const { limit = 50, offset = 0 } = req.query;
      const organizations = await prisma.organization.findMany({
        take: Number(limit),
        skip: Number(offset),
        include: {
          subscriptions: true
        },
        orderBy: { createdAt: 'desc' }
      });

      const total = await prisma.organization.count();

      res.json({
        success: true,
        data: {
          organizations,
          pagination: {
            total,
            limit: Number(limit),
            offset: Number(offset)
          }
        }
      });
    } catch (error) {
      logger.error('Admin get all organizations failed', {
        error: error instanceof Error ? error.message : String(error)
      });

      res.status(500).json({
        success: false,
        error: { code: 'admin_query_failed', message: 'Failed to query organizations' }
      });
    }
  }

  // GET /admin/webhook-events - 获取 webhook 事件
  async getWebhookEvents(req: Request, res: Response): Promise<void> {
    try {
      const { limit = 100, offset = 0 } = req.query;
      const events = await prisma.stripeEventProcessed.findMany({
        take: Number(limit),
        skip: Number(offset),
        orderBy: { processedAt: 'desc' }
      });

      const total = await prisma.stripeEventProcessed.count();

      res.json({
        success: true,
        data: {
          events,
          pagination: {
            total,
            limit: Number(limit),
            offset: Number(offset)
          }
        }
      });
    } catch (error) {
      logger.error('Admin get webhook events failed', {
        error: error instanceof Error ? error.message : String(error)
      });

      res.status(500).json({
        success: false,
        error: { code: 'admin_query_failed', message: 'Failed to query webhook events' }
      });
    }
  }

  // GET /admin/audit-logs - 获取审计日志
  async getAuditLogs(req: Request, res: Response): Promise<void> {
    try {
      const { limit = 100, offset = 0, entityType } = req.query;

      const whereClause: any = {};
      if (entityType) {
        whereClause.entityType = entityType as string;
      }

      const logs = await prisma.auditLog.findMany({
        where: whereClause,
        take: Number(limit),
        skip: Number(offset),
        orderBy: { timestamp: 'desc' }
      });

      const total = await prisma.auditLog.count({ where: whereClause });

      res.json({
        success: true,
        data: {
          logs,
          pagination: {
            total,
            limit: Number(limit),
            offset: Number(offset)
          }
        }
      });
    } catch (error) {
      logger.error('Admin get audit logs failed', {
        error: error instanceof Error ? error.message : String(error)
      });

      res.status(500).json({
        success: false,
        error: { code: 'admin_query_failed', message: 'Failed to query audit logs' }
      });
    }
  }

  // GET /admin/stats - 获取统计数据
  async getStats(req: Request, res: Response): Promise<void> {
    try {
      const [
        totalOrganizations,
        totalSubscriptions,
        activeSubscriptions,
        trialSubscriptions,
        recentEvents
      ] = await Promise.all([
        prisma.organization.count(),
        prisma.subscription.count(),
        prisma.subscription.count({ where: { status: SUBSCRIPTION_STATUS.ACTIVE } }),
        prisma.subscription.count({ where: { status: SUBSCRIPTION_STATUS.TRIALING } }),
        prisma.stripeEventProcessed.count({
          where: {
            processedAt: {
              gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // 最近24小时
            }
          }
        })
      ]);

      res.json({
        success: true,
        data: {
          organizations: totalOrganizations,
          subscriptions: {
            total: totalSubscriptions,
            active: activeSubscriptions,
            trial: trialSubscriptions
          },
          webhookEvents24h: recentEvents
        }
      });
    } catch (error) {
      logger.error('Admin get stats failed', {
        error: error instanceof Error ? error.message : String(error)
      });

      res.status(500).json({
        success: false,
        error: { code: 'admin_query_failed', message: 'Failed to get stats' }
      });
    }
  }
}

export const adminController = new AdminController();