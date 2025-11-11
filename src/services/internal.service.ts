import { PrismaClient } from '@prisma/client';
import type {
  CheckQuotaRequest,
  CheckAccessRequest,
  SuspendResourceRequest,
  RestoreResourceRequest,
  RecordUsageRequest,
  BatchRecordUsageRequest,
  StatsActiveResourcesRequest,
} from '../validators/internal.validators.js';

const prisma = new PrismaClient();

/**
 * Part 4: 内部API - Service层
 * 提供微服务间调用的业务逻辑
 */
export class InternalService {
  /**
   * 检查订阅是否启用了特定模块
   */
  private async hasModuleEnabled(organizationId: string, moduleCode: string): Promise<boolean> {
    const subscription = await prisma.subscription.findFirst({
      where: {
        orgId: organizationId,  // 数据库字段是 orgId
        status: {
          in: ['ACTIVE', 'TRIAL']
        }
      },
      include: {
        subscriptionModules: {
          include: {
            module: true
          }
        }
      }
    });

    if (!subscription) {
      return false;
    }

    return subscription.subscriptionModules.some(
      sm => sm.module.key === moduleCode && sm.isActive  // 字段名是 key 而不是 code
    );
  }

  /**
   * API 1: 检查资源配额
   * auth-service在创建设备/账号前调用
   */
  async checkQuota(data: CheckQuotaRequest) {
    const { orgId, resourceType, quantity = 1 } = data;

    // 查询订阅
    const subscription = await prisma.subscription.findUnique({
      where: { orgId },
      include: {
        subscriptionResources: {
          where: { removedAt: null },
          include: {
            resource: {
              select: {
                type: true,
                standardQuota: true,
              },
            },
          },
        },
        suspendedResources: {
          where: {
            restoredAt: null,
            resourceSubtype: resourceType,
          },
        },
      },
    });

    if (!subscription) {
      throw {
        code: 'SUBSCRIPTION_NOT_FOUND',
        statusCode: 404,
        message: 'No subscription found for this organization',
      };
    }

    // 检查订阅状态
    if (subscription.status === 'CANCELLED' || subscription.status === 'EXPIRED') {
      return {
        allowed: false,
        quotaInfo: {
          total: 0,
          used: 0,
          available: 0,
          suspended: 0,
        },
        subscriptionStatus: subscription.status,
        reason: `Subscription is ${subscription.status}`,
      };
    }

    // 获取Standard Plan配额
    const standardPlan = await prisma.standardPlan.findFirst({
      where: { status: 'ACTIVE' },
    });

    if (!standardPlan) {
      throw {
        code: 'STANDARD_PLAN_NOT_FOUND',
        statusCode: 404,
        message: 'No active Standard Plan found',
      };
    }

    const baseQuotas = standardPlan.resourceQuotas as Record<string, number>;
    let totalQuota = baseQuotas[resourceType] || 0;

    // 添加额外购买的配额
    subscription.subscriptionResources.forEach((sr) => {
      if (sr.resource.type === resourceType) {
        totalQuota += sr.quantity;
      }
    });

    // 计算已暂停的数量
    const suspendedCount = subscription.suspendedResources.length;

    // 这里的 used 需要从auth-service实时获取
    // 目前返回0作为占位，实际应该由API 7同步
    const used = 0; // TODO: 从缓存或auth-service获取

    const available = totalQuota - used - suspendedCount;
    const allowed = available >= quantity;

    return {
      allowed,
      quotaInfo: {
        total: totalQuota,
        used,
        available,
        suspended: suspendedCount,
      },
      subscriptionStatus: subscription.status,
      ...(! allowed && {
        reason: `Insufficient quota. Available: ${available}, Requested: ${quantity}`,
      }),
    };
  }

  /**
   * API 2: 检查访问权限
   * auth-service在设备/账号登录时调用
   */
  async checkAccess(data: CheckAccessRequest) {
    const { orgId, resourceType, resourceSubtype, resourceId } = data;

    // 查询订阅
    const subscription = await prisma.subscription.findUnique({
      where: { orgId },
      select: {
        status: true,
        gracePeriodEndsAt: true,
      },
    });

    if (!subscription) {
      return {
        allowed: false,
        reason: 'No subscription found for this organization',
        suspendedInfo: null,
        subscriptionStatus: null,
      };
    }

    // 检查订阅状态
    if (subscription.status === 'CANCELLED' || subscription.status === 'EXPIRED') {
      return {
        allowed: false,
        reason: `Subscription is ${subscription.status}`,
        suspendedInfo: null,
        subscriptionStatus: subscription.status,
      };
    }

    // 检查是否在宽限期（支付失败）
    if (subscription.status === 'SUSPENDED') {
      const now = new Date();
      const inGracePeriod =
        subscription.gracePeriodEndsAt && subscription.gracePeriodEndsAt > now;

      if (!inGracePeriod) {
        return {
          allowed: false,
          reason: 'Subscription suspended due to payment failure',
          suspendedInfo: null,
          subscriptionStatus: subscription.status,
        };
      }
    }

    // 查询是否被暂停
    const suspendedResource = await prisma.suspendedResource.findFirst({
      where: {
        subscription: { orgId },
        resourceType,
        resourceSubtype,
        resourceTargetId: resourceId,
        restoredAt: null,
      },
    });

    if (suspendedResource) {
      const now = new Date();
      const inGracePeriod = suspendedResource.graceExpiresAt > now;

      if (inGracePeriod) {
        // 宽限期内，仍可访问但返回警告
        const remainingDays = Math.ceil(
          (suspendedResource.graceExpiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );

        return {
          allowed: true,
          reason: null,
          suspendedInfo: {
            id: suspendedResource.id,
            suspendedAt: suspendedResource.suspendedAt,
            graceExpiresAt: suspendedResource.graceExpiresAt,
            reason: suspendedResource.reason,
            remainingDays,
            warning: `This resource will be suspended in ${remainingDays} days`,
          },
          subscriptionStatus: subscription.status,
        };
      } else {
        // 宽限期已过，不允许访问
        return {
          allowed: false,
          reason: `Resource suspended due to ${suspendedResource.reason}`,
          suspendedInfo: {
            id: suspendedResource.id,
            suspendedAt: suspendedResource.suspendedAt,
            graceExpiresAt: suspendedResource.graceExpiresAt,
            reason: suspendedResource.reason,
            remainingDays: 0,
            warning: null,
          },
          subscriptionStatus: subscription.status,
        };
      }
    }

    // 未被暂停，允许访问
    return {
      allowed: true,
      reason: null,
      suspendedInfo: null,
      subscriptionStatus: subscription.status,
    };
  }

  /**
   * API 3: 暂停资源
   * subscription-service内部调用，或手动暂停
   */
  async suspendResource(data: SuspendResourceRequest) {
    const { orgId, resourceType, resourceSubtype, resourceId, reason, gracePeriodDays = 30 } = data;

    // 查询订阅
    const subscription = await prisma.subscription.findUnique({
      where: { orgId },
      select: { id: true },
    });

    if (!subscription) {
      throw {
        code: 'SUBSCRIPTION_NOT_FOUND',
        statusCode: 404,
        message: 'Subscription not found for this organization',
      };
    }

    // 检查是否已经暂停
    const existingSuspended = await prisma.suspendedResource.findFirst({
      where: {
        subscriptionId: subscription.id,
        resourceType,
        resourceSubtype,
        resourceTargetId: resourceId,
        restoredAt: null,
      },
    });

    if (existingSuspended) {
      // 已经暂停，返回现有记录
      const now = new Date();
      const remainingDays = Math.ceil(
        (existingSuspended.graceExpiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );

      return {
        suspended: {
          id: existingSuspended.id,
          resourceId: existingSuspended.resourceTargetId,
          suspendedAt: existingSuspended.suspendedAt,
          graceExpiresAt: existingSuspended.graceExpiresAt,
          reason: existingSuspended.reason,
          remainingDays,
        },
        alreadySuspended: true,
      };
    }

    // 创建暂停记录
    const now = new Date();
    const graceExpiresAt = new Date(now);
    graceExpiresAt.setDate(graceExpiresAt.getDate() + gracePeriodDays);

    const suspendedResource = await prisma.suspendedResource.create({
      data: {
        subscriptionId: subscription.id,
        resourceType,
        resourceSubtype,
        resourceTargetId: resourceId,
        suspendedAt: now,
        graceExpiresAt,
        reason,
      },
    });

    return {
      suspended: {
        id: suspendedResource.id,
        resourceId: suspendedResource.resourceTargetId,
        suspendedAt: suspendedResource.suspendedAt,
        graceExpiresAt: suspendedResource.graceExpiresAt,
        reason: suspendedResource.reason,
        remainingDays: gracePeriodDays,
      },
      alreadySuspended: false,
    };
  }

  /**
   * API 4: 恢复资源
   * 取消暂停，恢复访问
   */
  async restoreResource(data: RestoreResourceRequest) {
    const { orgId, resourceType, resourceSubtype, resourceId } = data;

    // 查询订阅
    const subscription = await prisma.subscription.findUnique({
      where: { orgId },
      select: { id: true },
    });

    if (!subscription) {
      throw {
        code: 'SUBSCRIPTION_NOT_FOUND',
        statusCode: 404,
        message: 'Subscription not found for this organization',
      };
    }

    // 查询暂停记录
    const suspendedResource = await prisma.suspendedResource.findFirst({
      where: {
        subscriptionId: subscription.id,
        resourceType,
        resourceSubtype,
        resourceTargetId: resourceId,
        restoredAt: null,
      },
    });

    if (!suspendedResource) {
      return {
        restored: false,
        restoredAt: null,
        reason: 'Resource is not suspended',
      };
    }

    // 更新恢复时间
    const now = new Date();
    await prisma.suspendedResource.update({
      where: { id: suspendedResource.id },
      data: { restoredAt: now },
    });

    return {
      restored: true,
      restoredAt: now,
    };
  }

  /**
   * API 5: 记录使用量
   * notification-service发送SMS/Email后调用
   */
  async recordUsage(data: RecordUsageRequest) {
    const { orgId, usageType, quantity, metadata, moduleKey, providerRecordId } = data;

    // 根据usageType判断需要检查哪个模块
    let requiredModule: string | null = null;
    if (usageType === 'sms') {
      requiredModule = 'sms';
    } else if (usageType === 'email') {
      requiredModule = 'email';
    }

    // 检查是否订阅了相应模块
    if (requiredModule) {
      const hasModule = await this.hasModuleEnabled(orgId, requiredModule);
      if (!hasModule) {
        throw {
          code: 'MODULE_NOT_ENABLED',
          statusCode: 403,
          message: `${requiredModule.toUpperCase()} module is not enabled for this organization`,
        };
      }
    }

    // 查询订阅
    const subscription = await prisma.subscription.findUnique({
      where: { orgId },
      include: {
        subscriptionModules: {
          where: {
            isActive: true,
            ...(moduleKey && { module: { key: moduleKey } }),
          },
          include: {
            module: {
              select: { id: true, key: true },
            },
          },
        },
      },
    });

    if (!subscription) {
      throw {
        code: 'SUBSCRIPTION_NOT_FOUND',
        statusCode: 404,
        message: 'Subscription not found for this organization',
      };
    }

    // 检查幂等性（如果提供了providerRecordId）
    if (providerRecordId) {
      const existingUsage = await prisma.usage.findFirst({
        where: {
          subscriptionId: subscription.id,
          providerRecordId,
        },
      });

      if (existingUsage) {
        return {
          recorded: false,
          usageId: existingUsage.id,
          isFree: existingUsage.isFree,
          unitPrice: existingUsage.unitPrice.toNumber(),
          amount: existingUsage.amount.toNumber(),
          budgetWarning: null,
          reason: 'Usage already recorded (idempotent)',
        };
      }
    }

    // 获取定价
    const usagePricing = await prisma.usagePricing.findUnique({
      where: { usageType },
    });

    if (!usagePricing) {
      throw {
        code: 'USAGE_PRICING_NOT_FOUND',
        statusCode: 404,
        message: `No pricing found for usage type: ${usageType}`,
      };
    }

    const unitPrice = usagePricing.unitPrice.toNumber();

    // 判断是否免费（Trial期间）
    let isFree = false;
    if (subscription.status === 'TRIAL' && usageType === 'sms') {
      isFree = subscription.trialSmsEnabled && subscription.trialSmsUsed < 100; // Trial免费额度
    }

    const amount = isFree ? 0 : parseFloat((unitPrice * quantity).toFixed(2));

    // 获取moduleId
    let moduleId: string | null = null;
    if (moduleKey && subscription.subscriptionModules.length > 0) {
      moduleId = subscription.subscriptionModules[0]!.module.id;
    }

    // 创建使用记录
    const usage = await prisma.usage.create({
      data: {
        subscriptionId: subscription.id,
        moduleId,
        usageType,
        quantity,
        unitPrice,
        amount,
        isFree,
        metadata: metadata || {},
        providerRecordId: providerRecordId || null,
      },
    });

    // 更新Trial短信使用量
    if (isFree && usageType === 'sms') {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          trialSmsUsed: { increment: quantity },
        },
      });
    }

    // 更新SMS/Email当前花费（两者共用同一预算）
    if (!isFree && (usageType === 'sms' || usageType === 'email')) {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          smsCurrentSpending: { increment: amount },
        },
      });
    }

    // 检查SMS/Email预算警告（两者共用同一预算和告警设置）
    let budgetWarning: any = null;
    if (!isFree && (usageType === 'sms' || usageType === 'email') && subscription.smsMonthlyBudget) {
      const newSpending = subscription.smsCurrentSpending.toNumber() + amount;
      const budget = subscription.smsMonthlyBudget.toNumber();
      const percentage = (newSpending / budget) * 100;

      const alerts = (subscription.smsBudgetAlerts as number[]) || [];
      const triggeredAlerts = [50, 80, 95, 100].filter((threshold) => {
        return percentage >= threshold && !alerts.includes(threshold);
      });

      if (triggeredAlerts.length > 0) {
        budgetWarning = {
          currentSpending: newSpending,
          budget,
          percentage: parseFloat(percentage.toFixed(2)),
          triggeredAlerts,
          notifyByEmail: subscription.smsNotifyByEmail,
          notifyBySms: subscription.smsNotifyBySms,
        };

        // 更新已发送的警告
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            smsBudgetAlerts: [...alerts, ...triggeredAlerts],
          },
        });
      }
    }

    return {
      recorded: true,
      usageId: usage.id,
      isFree,
      unitPrice,
      amount,
      budgetWarning,
    };
  }

  /**
   * API 6: 批量记录使用量
   * 批量记录，提高性能
   */
  async batchRecordUsage(data: BatchRecordUsageRequest) {
    const { orgId, records } = data;

    const results = await Promise.allSettled(
      records.map((record) =>
        this.recordUsage({
          orgId,
          ...record,
        })
      )
    );

    const recorded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    const totalAmount = results
      .filter((r) => r.status === 'fulfilled')
      .reduce((sum, r) => sum + (r as PromiseFulfilledResult<any>).value.amount, 0);

    // 收集所有的预算警告
    const budgetWarnings = results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => (r as PromiseFulfilledResult<any>).value.budgetWarning)
      .filter((w) => w !== null);

    return {
      recorded,
      failed,
      totalAmount,
      budgetWarning: budgetWarnings.length > 0 ? budgetWarnings[budgetWarnings.length - 1] : null,
    };
  }

  /**
   * API 7: 统计活跃资源
   * auth-service定期同步实际的设备/账号数量
   */
  async statsActiveResources(data: StatsActiveResourcesRequest) {
    const { orgId, resources } = data;

    // 查询订阅
    const subscription = await prisma.subscription.findUnique({
      where: { orgId },
      include: {
        subscriptionResources: {
          where: { removedAt: null },
          include: {
            resource: {
              select: {
                type: true,
                standardQuota: true,
              },
            },
          },
        },
      },
    });

    if (!subscription) {
      throw {
        code: 'SUBSCRIPTION_NOT_FOUND',
        statusCode: 404,
        message: 'Subscription not found for this organization',
      };
    }

    // 获取Standard Plan配额
    const standardPlan = await prisma.standardPlan.findFirst({
      where: { status: 'ACTIVE' },
    });

    if (!standardPlan) {
      throw {
        code: 'STANDARD_PLAN_NOT_FOUND',
        statusCode: 404,
        message: 'No active Standard Plan found',
      };
    }

    const baseQuotas = standardPlan.resourceQuotas as Record<string, number>;

    // 计算每种资源的配额状态
    const quotaStatus: Record<string, any> = {};

    Object.entries(resources).forEach(([resourceType, used]) => {
      let quota = baseQuotas[resourceType] || 0;

      // 添加额外购买的配额
      subscription.subscriptionResources.forEach((sr) => {
        if (sr.resource.type === resourceType) {
          quota += sr.quantity;
        }
      });

      const available = Math.max(0, quota - used);
      const exceeded = used > quota;

      quotaStatus[resourceType] = {
        quota,
        used,
        available,
        exceeded,
      };
    });

    // TODO: 将这些数据缓存到Redis，供API 1快速查询
    // 目前只返回状态，不做持久化

    return {
      updated: true,
      quotaStatus,
    };
  }
}

// 导出单例
export const internalService = new InternalService();
