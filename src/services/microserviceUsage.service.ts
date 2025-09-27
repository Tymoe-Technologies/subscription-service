import { prisma } from '../infra/prisma';
import { logger } from '../utils/logger';

export interface UsageRecordRequest {
  organizationId: string;
  subscriptionId: string;
  serviceKey: string;
  usagePeriod: string; // "YYYY-MM-DD" | "YYYY-MM-DD-HH" | "YYYY-MM"
  periodType: 'hourly' | 'daily' | 'monthly';
  requestCount: number;
}

export interface UsageStatsRequest {
  organizationId: string;
  serviceKey?: string;
  periodType?: 'hourly' | 'daily' | 'monthly';
  startPeriod?: string;
  endPeriod?: string;
  limit?: number;
}

export class MicroserviceUsageService {

  // Record usage for a microservice
  async recordUsage(request: UsageRecordRequest) {
    try {
      // Use upsert to handle concurrent requests for the same period
      const usage = await prisma.microserviceUsage.upsert({
        where: {
          subscriptionId_serviceKey_usagePeriod_periodType: {
            subscriptionId: request.subscriptionId,
            serviceKey: request.serviceKey,
            usagePeriod: request.usagePeriod,
            periodType: request.periodType
          }
        },
        update: {
          requestCount: {
            increment: request.requestCount
          },
          updatedAt: new Date()
        },
        create: {
          organizationId: request.organizationId,
          subscriptionId: request.subscriptionId,
          serviceKey: request.serviceKey,
          usagePeriod: request.usagePeriod,
          periodType: request.periodType,
          requestCount: request.requestCount
        }
      });

      logger.info('Usage recorded', {
        organizationId: request.organizationId,
        serviceKey: request.serviceKey,
        usagePeriod: request.usagePeriod,
        requestCount: request.requestCount,
        totalCount: usage.requestCount
      });

      return usage;
    } catch (error) {
      logger.error('Failed to record usage', {
        error: error instanceof Error ? error.message : String(error),
        request
      });
      throw error;
    }
  }

  // Get usage statistics
  async getUsageStats(request: UsageStatsRequest) {
    try {
      const where: any = {
        organizationId: request.organizationId
      };

      if (request.serviceKey) {
        where.serviceKey = request.serviceKey;
      }

      if (request.periodType) {
        where.periodType = request.periodType;
      }

      if (request.startPeriod || request.endPeriod) {
        where.usagePeriod = {};
        if (request.startPeriod) {
          where.usagePeriod.gte = request.startPeriod;
        }
        if (request.endPeriod) {
          where.usagePeriod.lte = request.endPeriod;
        }
      }

      const [usage, total] = await Promise.all([
        prisma.microserviceUsage.findMany({
          where,
          orderBy: { usagePeriod: 'desc' },
          take: request.limit || 100,
          include: {
            subscription: {
              select: {
                id: true,
                productKey: true,
                status: true
              }
            }
          }
        }),
        prisma.microserviceUsage.count({ where })
      ]);

      return { usage, total };
    } catch (error) {
      logger.error('Failed to get usage stats', {
        error: error instanceof Error ? error.message : String(error),
        request
      });
      throw error;
    }
  }

  // Get aggregated usage by service
  async getUsageByService(organizationId: string, periodType: string, startPeriod?: string, endPeriod?: string) {
    try {
      const where: any = {
        organizationId,
        periodType
      };

      if (startPeriod || endPeriod) {
        where.usagePeriod = {};
        if (startPeriod) {
          where.usagePeriod.gte = startPeriod;
        }
        if (endPeriod) {
          where.usagePeriod.lte = endPeriod;
        }
      }

      const usageByService = await prisma.microserviceUsage.groupBy({
        by: ['serviceKey'],
        where,
        _sum: {
          requestCount: true
        },
        _count: {
          id: true
        },
        orderBy: {
          _sum: {
            requestCount: 'desc'
          }
        }
      });

      return usageByService.map(item => ({
        serviceKey: item.serviceKey,
        totalRequests: item._sum.requestCount || 0,
        recordCount: item._count.id
      }));
    } catch (error) {
      logger.error('Failed to get usage by service', {
        error: error instanceof Error ? error.message : String(error),
        organizationId,
        periodType
      });
      throw error;
    }
  }

  // Get usage trends over time
  async getUsageTrends(organizationId: string, serviceKey: string, periodType: string, limit: number = 30) {
    try {
      const usage = await prisma.microserviceUsage.findMany({
        where: {
          organizationId,
          serviceKey,
          periodType
        },
        orderBy: { usagePeriod: 'desc' },
        take: limit,
        select: {
          usagePeriod: true,
          requestCount: true,
          createdAt: true
        }
      });

      return usage.reverse(); // Return in chronological order
    } catch (error) {
      logger.error('Failed to get usage trends', {
        error: error instanceof Error ? error.message : String(error),
        organizationId,
        serviceKey,
        periodType
      });
      throw error;
    }
  }

  // Get current period usage for rate limiting
  async getCurrentPeriodUsage(organizationId: string, serviceKey: string, periodType: string) {
    try {
      // Generate current period string based on type
      const now = new Date();
      let currentPeriod: string;

      switch (periodType) {
        case 'hourly':
          currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}`;
          break;
        case 'daily':
          currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
          break;
        case 'monthly':
          currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
          break;
        default:
          throw new Error(`Invalid period type: ${periodType}`);
      }

      const usage = await prisma.microserviceUsage.findFirst({
        where: {
          organizationId,
          serviceKey,
          usagePeriod: currentPeriod,
          periodType
        }
      });

      return {
        currentPeriod,
        requestCount: usage?.requestCount || 0,
        lastUpdated: usage?.updatedAt
      };
    } catch (error) {
      logger.error('Failed to get current period usage', {
        error: error instanceof Error ? error.message : String(error),
        organizationId,
        serviceKey,
        periodType
      });
      throw error;
    }
  }

  // Cleanup old usage records
  async cleanupOldUsage(daysToKeep: number = 90) {
    try {
      const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);

      const result = await prisma.microserviceUsage.deleteMany({
        where: {
          createdAt: {
            lt: cutoffDate
          },
          periodType: 'hourly' // Only cleanup hourly records, keep daily/monthly longer
        }
      });

      logger.info('Old usage records cleaned up', {
        deletedCount: result.count,
        cutoffDate: cutoffDate.toISOString()
      });

      return result.count;
    } catch (error) {
      logger.error('Failed to cleanup old usage records', {
        error: error instanceof Error ? error.message : String(error),
        daysToKeep
      });
      throw error;
    }
  }
}

export const microserviceUsageService = new MicroserviceUsageService();