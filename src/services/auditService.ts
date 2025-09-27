import { prisma } from '../infra/prisma';
import { logger } from '../utils/logger';
import type { Request } from 'express';

export type EntityType = 'SUBSCRIPTION' | 'ORGANIZATION' | 'TRIAL' | 'INTENT';
export type ActionType = 'CREATE' | 'UPDATE' | 'DELETE' | 'CANCEL' | 'REACTIVATE' | 'UPGRADE' | 'DOWNGRADE';
export type ActorType = 'USER' | 'ADMIN' | 'WEBHOOK' | 'SYSTEM';

export interface AuditContext {
  entityType: EntityType;
  entityId: string;
  action: ActionType;
  actorType: ActorType;
  actorId?: string | null;
  changes?: Record<string, any> | undefined;
  metadata?: Record<string, any> | undefined;
}

export interface AuditLog {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actorType: string;
  actorId?: string | null;
  changes?: any;
  metadata?: any;
  timestamp: Date;
}

export class AuditService {

  async log(context: AuditContext): Promise<AuditLog> {
    try {
      const auditLog = await prisma.auditLog.create({
        data: {
          entityType: context.entityType,
          entityId: context.entityId,
          action: context.action,
          actorType: context.actorType,
          actorId: context.actorId || null,
          changes: context.changes || {},
          metadata: context.metadata || {}
        }
      });

      logger.info('Audit log created', {
        auditLogId: auditLog.id,
        entityType: context.entityType,
        entityId: context.entityId,
        action: context.action,
        actorType: context.actorType
      });

      return auditLog;
    } catch (error) {
      logger.error('Failed to create audit log', {
        error: error instanceof Error ? error.message : String(error),
        context
      });
      throw error;
    }
  }

  async logSubscriptionChange(
    subscriptionId: string,
    action: ActionType,
    actorType: ActorType,
    actorId?: string | null,
    changes?: Record<string, any>,
    req?: Request
  ): Promise<AuditLog> {
    const metadata: Record<string, any> = {};

    if (req) {
      metadata.ip = req.ip || req.connection.remoteAddress;
      metadata.userAgent = req.get('User-Agent');
      metadata.method = req.method;
      metadata.url = req.originalUrl;
    }

    return this.log({
      entityType: 'SUBSCRIPTION',
      entityId: subscriptionId,
      action,
      actorType,
      actorId: actorId ?? null,
      changes,
      metadata
    });
  }

  async logOrganizationChange(
    organizationId: string,
    action: ActionType,
    actorType: ActorType,
    actorId?: string | null,
    changes?: Record<string, any>,
    req?: Request
  ): Promise<AuditLog> {
    const metadata: Record<string, any> = {};

    if (req) {
      metadata.ip = req.ip || req.connection.remoteAddress;
      metadata.userAgent = req.get('User-Agent');
      metadata.method = req.method;
      metadata.url = req.originalUrl;
    }

    return this.log({
      entityType: 'ORGANIZATION',
      entityId: organizationId,
      action,
      actorType,
      actorId: actorId ?? null,
      changes,
      metadata
    });
  }

  async logTrialChange(
    trialId: string,
    action: ActionType,
    actorType: ActorType,
    actorId?: string | null,
    changes?: Record<string, any>,
    req?: Request
  ): Promise<AuditLog> {
    const metadata: Record<string, any> = {};

    if (req) {
      metadata.ip = req.ip || req.connection.remoteAddress;
      metadata.userAgent = req.get('User-Agent');
      metadata.method = req.method;
      metadata.url = req.originalUrl;
    }

    return this.log({
      entityType: 'TRIAL',
      entityId: trialId,
      action,
      actorType,
      actorId: actorId ?? null,
      changes,
      metadata
    });
  }

  async logIntentChange(
    intentId: string,
    action: ActionType,
    actorType: ActorType,
    actorId?: string | null,
    changes?: Record<string, any>,
    req?: Request
  ): Promise<AuditLog> {
    const metadata: Record<string, any> = {};

    if (req) {
      metadata.ip = req.ip || req.connection.remoteAddress;
      metadata.userAgent = req.get('User-Agent');
      metadata.method = req.method;
      metadata.url = req.originalUrl;
    }

    return this.log({
      entityType: 'INTENT',
      entityId: intentId,
      action,
      actorType,
      actorId: actorId ?? null,
      changes,
      metadata
    });
  }

  async getAuditLogs(filters: {
    entityType?: EntityType;
    entityId?: string;
    actorType?: ActorType;
    actorId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ logs: AuditLog[]; total: number }> {
    try {
      const where: any = {};

      if (filters.entityType) {
        where.entityType = filters.entityType;
      }

      if (filters.entityId) {
        where.entityId = filters.entityId;
      }

      if (filters.actorType) {
        where.actorType = filters.actorType;
      }

      if (filters.actorId) {
        where.actorId = filters.actorId;
      }

      if (filters.startDate || filters.endDate) {
        where.timestamp = {};
        if (filters.startDate) {
          where.timestamp.gte = filters.startDate;
        }
        if (filters.endDate) {
          where.timestamp.lte = filters.endDate;
        }
      }

      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          orderBy: { timestamp: 'desc' },
          take: filters.limit || 100,
          skip: filters.offset || 0
        }),
        prisma.auditLog.count({ where })
      ]);

      return { logs, total };
    } catch (error) {
      logger.error('Failed to get audit logs', {
        error: error instanceof Error ? error.message : String(error),
        filters
      });
      throw error;
    }
  }

  async getEntityHistory(
    entityType: EntityType,
    entityId: string,
    limit: number = 50
  ): Promise<AuditLog[]> {
    try {
      return await prisma.auditLog.findMany({
        where: {
          entityType,
          entityId
        },
        orderBy: { timestamp: 'desc' },
        take: limit
      });
    } catch (error) {
      logger.error('Failed to get entity history', {
        error: error instanceof Error ? error.message : String(error),
        entityType,
        entityId
      });
      throw error;
    }
  }

  async getRecentActivity(
    hours: number = 24,
    limit: number = 100
  ): Promise<AuditLog[]> {
    try {
      const startDate = new Date(Date.now() - hours * 60 * 60 * 1000);

      return await prisma.auditLog.findMany({
        where: {
          timestamp: {
            gte: startDate
          }
        },
        orderBy: { timestamp: 'desc' },
        take: limit
      });
    } catch (error) {
      logger.error('Failed to get recent activity', {
        error: error instanceof Error ? error.message : String(error),
        hours,
        limit
      });
      throw error;
    }
  }

  async cleanupOldLogs(daysToKeep: number = 90): Promise<number> {
    try {
      const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);

      const result = await prisma.auditLog.deleteMany({
        where: {
          timestamp: {
            lt: cutoffDate
          }
        }
      });

      logger.info('Old audit logs cleaned up', {
        deletedCount: result.count,
        cutoffDate: cutoffDate.toISOString()
      });

      return result.count;
    } catch (error) {
      logger.error('Failed to cleanup old audit logs', {
        error: error instanceof Error ? error.message : String(error),
        daysToKeep
      });
      throw error;
    }
  }
}

export const auditService = new AuditService();