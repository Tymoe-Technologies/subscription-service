import { prisma } from '../infra/prisma.js';
import { logger } from '../utils/logger.js';
import { getMicroserviceAccess, canAccessMicroservice } from '../config/microservices.js';
import { v4 as uuidv4 } from 'uuid';

export interface UsageCheckResult {
  allowed: boolean;
  reason?: string;
  currentUsage?: number;
  limit?: number;
  resetTime?: Date;
}

export interface UsageReportResult {
  usage: Array<{
    id: string;
    organizationId: string;
    serviceKey: string;
    usagePeriod: string;
    periodType: string;
    requestCount: number;
    createdAt: Date;
    updatedAt: Date;
  }>;
  concurrent: Array<{
    serviceKey: string;
    requestId: string;
    startedAt: Date;
  }>;
}

export class MicroservicePermissionService {
  // 检查用户是否可以调用微服务API
  async checkPermission(
    organizationId: string,
    serviceKey: string,
    tier: string
  ): Promise<UsageCheckResult> {
    try {
      // 1. 检查基础权限
      if (!canAccessMicroservice(tier, serviceKey)) {
        return {
          allowed: false,
          reason: `Tier '${tier}' does not have access to service '${serviceKey}'`,
        };
      }

      // 2. 获取限制配置
      const limits = getMicroserviceAccess(tier, serviceKey);
      if (!limits || !limits.enabled) {
        return {
          allowed: false,
          reason: `Service '${serviceKey}' is not enabled for tier '${tier}'`,
        };
      }

      // 3. 检查并发限制
      if (limits.concurrentRequests && limits.concurrentRequests > 0) {
        const concurrentCount = await this.getConcurrentRequestCount(organizationId, serviceKey);
        if (concurrentCount >= limits.concurrentRequests) {
          return {
            allowed: false,
            reason: 'Concurrent request limit exceeded',
            currentUsage: concurrentCount,
            limit: limits.concurrentRequests,
          };
        }
      }

      // 4. 检查每小时限制
      if (limits.hourlyRequests && limits.hourlyRequests > 0) {
        const hourlyUsage = await this.getUsageCount(organizationId, serviceKey, 'hourly');
        if (hourlyUsage >= limits.hourlyRequests) {
          return {
            allowed: false,
            reason: 'Hourly request limit exceeded',
            currentUsage: hourlyUsage,
            limit: limits.hourlyRequests,
            resetTime: this.getNextHourReset(),
          };
        }
      }

      // 5. 检查每日限制
      if (limits.dailyRequests && limits.dailyRequests > 0) {
        const dailyUsage = await this.getUsageCount(organizationId, serviceKey, 'daily');
        if (dailyUsage >= limits.dailyRequests) {
          return {
            allowed: false,
            reason: 'Daily request limit exceeded',
            currentUsage: dailyUsage,
            limit: limits.dailyRequests,
            resetTime: this.getNextDayReset(),
          };
        }
      }

      // 6. 检查每月限制
      if (limits.monthlyRequests && limits.monthlyRequests > 0) {
        const monthlyUsage = await this.getUsageCount(organizationId, serviceKey, 'monthly');
        if (monthlyUsage >= limits.monthlyRequests) {
          return {
            allowed: false,
            reason: 'Monthly request limit exceeded',
            currentUsage: monthlyUsage,
            limit: limits.monthlyRequests,
            resetTime: this.getNextMonthReset(),
          };
        }
      }

      return { allowed: true };
    } catch (error) {
      logger.error('Error checking microservice permission', {
        organizationId,
        serviceKey,
        tier,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        allowed: false,
        reason: 'Permission check failed',
      };
    }
  }

  // 记录API调用开始（用于并发控制）
  async recordRequestStart(
    organizationId: string,
    serviceKey: string
  ): Promise<string> {
    const requestId = uuidv4();

    try {
      await prisma.concurrentRequests.create({
        data: {
          organizationId,
          serviceKey,
          requestId,
        },
      });

      return requestId;
    } catch (error) {
      logger.error('Error recording request start', {
        organizationId,
        serviceKey,
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      return requestId;
    }
  }

  // 记录API调用结束
  async recordRequestEnd(
    organizationId: string,
    serviceKey: string,
    requestId: string
  ): Promise<void> {
    try {
      // 移除并发请求记录
      await prisma.concurrentRequests.deleteMany({
        where: {
          organizationId,
          serviceKey,
          requestId,
        },
      });

      // 增加使用量统计
      await Promise.all([
        this.incrementUsage(organizationId, serviceKey, 'hourly'),
        this.incrementUsage(organizationId, serviceKey, 'daily'),
        this.incrementUsage(organizationId, serviceKey, 'monthly'),
      ]);
    } catch (error) {
      logger.error('Error recording request end', {
        organizationId,
        serviceKey,
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // 获取当前并发请求数
  private async getConcurrentRequestCount(
    organizationId: string,
    serviceKey: string
  ): Promise<number> {
    return await prisma.concurrentRequests.count({
      where: {
        organizationId,
        serviceKey,
      },
    });
  }

  // 获取使用量统计
  private async getUsageCount(
    organizationId: string,
    serviceKey: string,
    periodType: 'hourly' | 'daily' | 'monthly'
  ): Promise<number> {
    const period = this.getCurrentPeriod(periodType);

    const usage = await prisma.microserviceUsage.findUnique({
      where: {
        organizationId_serviceKey_usagePeriod_periodType: {
          organizationId,
          serviceKey,
          usagePeriod: period,
          periodType,
        },
      },
    });

    return usage?.requestCount || 0;
  }

  // 增加使用量统计
  private async incrementUsage(
    organizationId: string,
    serviceKey: string,
    periodType: 'hourly' | 'daily' | 'monthly'
  ): Promise<void> {
    const period = this.getCurrentPeriod(periodType);

    await prisma.microserviceUsage.upsert({
      where: {
        organizationId_serviceKey_usagePeriod_periodType: {
          organizationId,
          serviceKey,
          usagePeriod: period,
          periodType,
        },
      },
      create: {
        organizationId,
        serviceKey,
        usagePeriod: period,
        periodType,
        requestCount: 1,
      },
      update: {
        requestCount: {
          increment: 1,
        },
      },
    });
  }

  // 获取当前时间周期字符串
  private getCurrentPeriod(periodType: 'hourly' | 'daily' | 'monthly'): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');

    switch (periodType) {
      case 'hourly':
        return `${year}-${month}-${day}-${hour}`;
      case 'daily':
        return `${year}-${month}-${day}`;
      case 'monthly':
        return `${year}-${month}`;
      default:
        throw new Error(`Invalid period type: ${periodType}`);
    }
  }

  // 获取下一次重置时间
  private getNextHourReset(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0, 0);
  }

  private getNextDayReset(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  }

  private getNextMonthReset(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
  }

  // 获取组织的使用情况报告
  async getUsageReport(organizationId: string, serviceKey?: string): Promise<UsageReportResult> {
    const where: { organizationId: string; serviceKey?: string } = { organizationId };
    if (serviceKey) {
      where.serviceKey = serviceKey;
    }

    const usageData = await prisma.microserviceUsage.findMany({
      where,
      orderBy: [{ serviceKey: 'asc' }, { usagePeriod: 'desc' }],
    });

    const concurrentData = await prisma.concurrentRequests.findMany({
      where,
      select: {
        serviceKey: true,
        requestId: true,
        startedAt: true,
      },
    });

    return {
      usage: usageData,
      concurrent: concurrentData,
    };
  }

  // 清理过期的并发请求记录（清理超过1小时的记录）
  async cleanupExpiredConcurrentRequests(): Promise<{ count: number }> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    try {
      const result = await prisma.concurrentRequests.deleteMany({
        where: {
          startedAt: {
            lt: oneHourAgo,
          },
        },
      });

      if (result.count > 0) {
        logger.info('Cleaned up expired concurrent requests', {
          count: result.count,
        });
      }

      return { count: result.count };
    } catch (error) {
      logger.error('Error cleaning up expired concurrent requests', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { count: 0 };
    }
  }
}

export const microservicePermissionService = new MicroservicePermissionService();