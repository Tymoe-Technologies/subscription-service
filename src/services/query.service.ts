import { PrismaClient, InvoiceStatus } from '@prisma/client';
import type {
  GetInvoicesQuery,
  GetUsageQuery,
  GetUsageSummaryQuery,
  GetLogsQuery,
} from '../validators/query.validators.js';

const prisma = new PrismaClient();

/**
 * Part 3: 查询API - Service层
 * 提供订阅查询相关的业务逻辑
 */
export class QueryService {
  /**
   * API 1: 查询当前订阅详情
   */
  async getCurrentSubscription(orgId: string) {
    const subscription = await prisma.subscription.findUnique({
      where: { orgId },
      include: {
        subscriptionModules: {
          where: { isActive: true },
          include: {
            module: {
              select: {
                id: true,
                key: true,
                name: true,
                category: true,
                monthlyPrice: true,
                status: true,
              },
            },
          },
        },
        subscriptionResources: {
          where: { removedAt: null },
          include: {
            resource: {
              select: {
                id: true,
                type: true,
                category: true,
                name: true,
                monthlyPrice: true,
                standardQuota: true,
              },
            },
          },
        },
        suspendedResources: {
          where: { restoredAt: null },
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

    // 计算资源配额详情
    const resourceQuotas = await this.calculateResourceQuotas(subscription);

    // 计算总月费
    const monthlyTotal = this.calculateMonthlyTotal(subscription);

    // 格式化返回数据
    return {
      subscription: {
        id: subscription.id,
        orgId: subscription.orgId,
        payerId: subscription.payerId,
        status: subscription.status,
        billingCycle: subscription.billingCycle,
        startedAt: subscription.startedAt,
        renewsAt: subscription.renewsAt,
        trialEndsAt: subscription.trialEndsAt,
        autoRenew: subscription.autoRenew,
        standardPrice: subscription.standardPrice,
        cancelledAt: subscription.cancelledAt,
        cancelReason: subscription.cancelReason,
        paymentProvider: subscription.paymentProvider,
        paymentLast4: subscription.paymentLast4,
        createdAt: subscription.createdAt,
        updatedAt: subscription.updatedAt,
      },
      modules: {
        included: subscription.subscriptionModules
          .filter((sm) => sm.module.monthlyPrice.toNumber() === 0 || sm.addedAt <= subscription.startedAt!)
          .map((sm) => ({
            moduleId: sm.module.id,
            key: sm.module.key,
            name: sm.module.name,
            category: sm.module.category,
            isActive: sm.isActive,
            addedAt: sm.addedAt,
            removedAt: sm.removedAt,
          })),
        optional: subscription.subscriptionModules
          .filter((sm) => sm.module.monthlyPrice.toNumber() > 0 && sm.addedAt > (subscription.startedAt || new Date(0)))
          .map((sm) => ({
            moduleId: sm.module.id,
            key: sm.module.key,
            name: sm.module.name,
            category: sm.module.category,
            monthlyPrice: sm.module.monthlyPrice,
            isActive: sm.isActive,
            addedAt: sm.addedAt,
            removedAt: sm.removedAt,
          })),
      },
      resources: resourceQuotas,
      sms: {
        trialSmsUsed: subscription.trialSmsUsed,
        trialSmsEnabled: subscription.trialSmsEnabled,
        monthlyBudget: subscription.smsMonthlyBudget,
        currentSpending: subscription.smsCurrentSpending,
        budgetAlerts: subscription.smsBudgetAlerts,
        notifyByEmail: subscription.smsNotifyByEmail,
        notifyBySms: subscription.smsNotifyBySms,
      },
      billing: {
        monthlyTotal: monthlyTotal,
        breakdown: this.getMonthlyBreakdown(subscription),
        nextBillingDate: subscription.renewsAt,
        paymentProvider: subscription.paymentProvider,
        paymentLast4: subscription.paymentLast4,
      },
      ...(subscription.status === 'TRIAL' && {
        trial: {
          endsAt: subscription.trialEndsAt,
          remainingDays: this.calculateRemainingDays(subscription.trialEndsAt!),
        },
      }),
      ...(subscription.cancelledAt && {
        cancellation: {
          cancelledAt: subscription.cancelledAt,
          reason: subscription.cancelReason,
          effectiveDate: subscription.renewsAt,
          remainingDays: this.calculateRemainingDays(subscription.renewsAt!),
        },
      }),
    };
  }

  /**
   * API 2: 查询账单历史
   */
  async getInvoices(orgId: string, query: GetInvoicesQuery) {
    const { page, pageSize, status, from, to } = query;
    const skip = (page - 1) * pageSize;

    // 先确认订阅存在
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

    // 构建筛选条件
    const where: any = {
      subscriptionId: subscription.id,
    };

    if (status) {
      where.status = status;
    }

    if (from || to) {
      where.periodStart = {};
      if (from) where.periodStart.gte = new Date(from);
      if (to) where.periodStart.lte = new Date(to);
    }

    // 查询发票列表和总数
    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { periodStart: 'desc' },
        select: {
          id: true,
          number: true,
          periodStart: true,
          periodEnd: true,
          items: true,
          subtotal: true,
          discount: true,
          tax: true,
          total: true,
          status: true,
          paidAt: true,
          paymentProvider: true,
          failureReason: true,
          pdfUrl: true,
          createdAt: true,
        },
      }),
      prisma.invoice.count({ where }),
    ]);

    return {
      invoices: invoices.map((invoice) => ({
        ...invoice,
        itemsSummary: this.summarizeInvoiceItems(invoice.items as any),
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * API 3: 查询单个发票详情
   */
  async getInvoiceById(orgId: string, invoiceId: string) {
    // 先确认订阅存在
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

    const invoice = await prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        subscriptionId: subscription.id,
      },
      include: {
        usages: {
          select: {
            id: true,
            usageType: true,
            quantity: true,
            unitPrice: true,
            amount: true,
            isFree: true,
            metadata: true,
            createdAt: true,
          },
        },
      },
    });

    if (!invoice) {
      throw {
        code: 'INVOICE_NOT_FOUND',
        statusCode: 404,
        message: 'Invoice not found',
      };
    }

    return {
      invoice: {
        ...invoice,
        itemsDetailed: invoice.items,
      },
      usages: invoice.usages,
    };
  }

  /**
   * API 4: 查询使用量明细
   */
  async getUsage(orgId: string, query: GetUsageQuery) {
    const { page, pageSize, usageType, moduleId, from, to, isFree } = query;
    const skip = (page - 1) * pageSize;

    // 先确认订阅存在
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

    // 构建筛选条件
    const where: any = {
      subscriptionId: subscription.id,
    };

    if (usageType) {
      where.usageType = usageType;
    }

    if (moduleId) {
      where.moduleId = moduleId;
    }

    if (isFree !== undefined) {
      where.isFree = isFree;
    }

    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    // 查询使用记录和总数
    const [usages, total] = await Promise.all([
      prisma.usage.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          module: {
            select: {
              key: true,
              name: true,
            },
          },
        },
      }),
      prisma.usage.count({ where }),
    ]);

    return {
      usages: usages.map((usage) => ({
        id: usage.id,
        usageType: usage.usageType,
        quantity: usage.quantity,
        unitPrice: usage.unitPrice,
        amount: usage.amount,
        isFree: usage.isFree,
        metadata: usage.metadata,
        module: usage.module,
        billedAt: usage.billedAt,
        invoiceId: usage.invoiceId,
        createdAt: usage.createdAt,
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * API 5: 查询使用量统计
   */
  async getUsageSummary(orgId: string, query: GetUsageSummaryQuery) {
    const { from, to } = query;

    // 先确认订阅存在
    const subscription = await prisma.subscription.findUnique({
      where: { orgId },
      select: { id: true, renewsAt: true, status: true },
    });

    if (!subscription) {
      throw {
        code: 'SUBSCRIPTION_NOT_FOUND',
        statusCode: 404,
        message: 'Subscription not found for this organization',
      };
    }

    // 确定查询时间范围（默认当前计费周期）
    const currentPeriodStart = from ? new Date(from) : this.getCurrentBillingPeriodStart(subscription.renewsAt!);
    const currentPeriodEnd = to ? new Date(to) : subscription.renewsAt!;

    // 按usageType分组统计
    const usageSummary = await prisma.usage.groupBy({
      by: ['usageType', 'isFree'],
      where: {
        subscriptionId: subscription.id,
        createdAt: {
          gte: currentPeriodStart,
          lte: currentPeriodEnd,
        },
      },
      _sum: {
        quantity: true,
        amount: true,
      },
      _count: {
        id: true,
      },
    });

    // 格式化统计结果
    const summaryByType: Record<string, any> = {};
    let totalFree = 0;
    let totalPaid = 0;

    usageSummary.forEach((item) => {
      if (!summaryByType[item.usageType]) {
        summaryByType[item.usageType] = {
          usageType: item.usageType,
          free: { quantity: 0, count: 0, amount: 0 },
          paid: { quantity: 0, count: 0, amount: 0 },
          total: { quantity: 0, count: 0, amount: 0 },
        };
      }

      const category = item.isFree ? 'free' : 'paid';
      summaryByType[item.usageType][category] = {
        quantity: item._sum.quantity || 0,
        count: item._count.id,
        amount: item._sum.amount?.toNumber() || 0,
      };

      // 更新总计
      summaryByType[item.usageType].total.quantity += item._sum.quantity || 0;
      summaryByType[item.usageType].total.count += item._count.id;
      summaryByType[item.usageType].total.amount += item._sum.amount?.toNumber() || 0;

      if (item.isFree) {
        totalFree += item._sum.amount?.toNumber() || 0;
      } else {
        totalPaid += item._sum.amount?.toNumber() || 0;
      }
    });

    return {
      period: {
        start: currentPeriodStart,
        end: currentPeriodEnd,
      },
      summary: Object.values(summaryByType),
      totals: {
        free: totalFree,
        paid: totalPaid,
        total: totalFree + totalPaid,
      },
    };
  }

  /**
   * API 6: 预览激活后费用
   */
  async previewActivation(orgId: string) {
    const subscription = await prisma.subscription.findUnique({
      where: { orgId },
      include: {
        subscriptionModules: {
          where: { isActive: true },
          include: {
            module: {
              select: {
                key: true,
                name: true,
                monthlyPrice: true,
              },
            },
          },
        },
        subscriptionResources: {
          where: { removedAt: null },
          include: {
            resource: {
              select: {
                type: true,
                name: true,
                monthlyPrice: true,
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

    if (subscription.status !== 'TRIAL') {
      throw {
        code: 'INVALID_STATUS',
        statusCode: 400,
        message: 'Preview activation is only available for Trial subscriptions',
      };
    }

    // 计算激活后的首次费用
    const breakdown: any = {
      standardPlan: subscription.standardPrice.toNumber(),
      modules: {},
      resources: {},
    };

    let modulesTotal = 0;
    subscription.subscriptionModules.forEach((sm) => {
      if (sm.module.monthlyPrice.toNumber() > 0) {
        breakdown.modules[sm.module.key] = sm.module.monthlyPrice.toNumber();
        modulesTotal += sm.module.monthlyPrice.toNumber();
      }
    });

    let resourcesTotal = 0;
    subscription.subscriptionResources.forEach((sr) => {
      const cost = sr.resource.monthlyPrice.toNumber() * sr.quantity;
      breakdown.resources[sr.resource.type] = {
        quantity: sr.quantity,
        unitPrice: sr.resource.monthlyPrice.toNumber(),
        total: cost,
      };
      resourcesTotal += cost;
    });

    const monthlyTotal = breakdown.standardPlan + modulesTotal + resourcesTotal;

    // 计算下次续费时间（从Trial结束时间开始）
    const trialEndsAt = subscription.trialEndsAt!;
    const firstBillingDate = new Date(trialEndsAt);
    const nextBillingDate = new Date(firstBillingDate);
    nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);

    return {
      preview: {
        firstChargeDate: firstBillingDate,
        firstChargeAmount: monthlyTotal,
        recurringMonthlyAmount: monthlyTotal,
        nextBillingDate: nextBillingDate,
      },
      breakdown: {
        standardPlan: breakdown.standardPlan,
        modulesTotal: modulesTotal,
        modulesDetails: breakdown.modules,
        resourcesTotal: resourcesTotal,
        resourcesDetails: breakdown.resources,
        total: monthlyTotal,
      },
    };
  }

  /**
   * API 7: 查询可用配额
   */
  async getQuotas(orgId: string) {
    const subscription = await prisma.subscription.findUnique({
      where: { orgId },
      include: {
        subscriptionResources: {
          where: { removedAt: null },
          include: {
            resource: {
              select: {
                type: true,
                category: true,
                name: true,
                standardQuota: true,
                monthlyPrice: true,
              },
            },
          },
        },
        suspendedResources: {
          where: { restoredAt: null },
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

    // 获取Standard Plan的基础配额
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

    // 计算每种资源的总配额
    const resources: Record<string, any> = {};

    // 初始化基础配额
    Object.entries(baseQuotas).forEach(([type, quota]) => {
      resources[type] = {
        type,
        baseQuota: quota,
        extraQuota: 0,
        totalQuota: quota,
        // 注意：实际使用量需要从auth-service获取，这里先返回0
        currentUsage: 0,
        available: quota,
        suspended: 0,
      };
    });

    // 添加额外购买的配额
    subscription.subscriptionResources.forEach((sr) => {
      const type = sr.resource.type;
      if (!resources[type]) {
        resources[type] = {
          type,
          baseQuota: 0,
          extraQuota: 0,
          totalQuota: 0,
          currentUsage: 0,
          available: 0,
          suspended: 0,
        };
      }
      resources[type].extraQuota += sr.quantity;
      resources[type].totalQuota += sr.quantity;
      resources[type].available += sr.quantity;
    });

    // 统计暂停的资源
    subscription.suspendedResources.forEach((sr) => {
      const type = sr.resourceSubtype;
      if (resources[type]) {
        resources[type].suspended += 1;
      }
    });

    return {
      resources: Object.values(resources),
      suspended: subscription.suspendedResources.map((sr) => ({
        id: sr.id,
        resourceType: sr.resourceType,
        resourceSubtype: sr.resourceSubtype,
        resourceTargetId: sr.resourceTargetId,
        suspendedAt: sr.suspendedAt,
        graceExpiresAt: sr.graceExpiresAt,
        reason: sr.reason,
        remainingDays: this.calculateRemainingDays(sr.graceExpiresAt),
      })),
      sms: {
        trialSmsEnabled: subscription.trialSmsEnabled,
        trialSmsUsed: subscription.trialSmsUsed,
        monthlyBudget: subscription.smsMonthlyBudget,
        currentSpending: subscription.smsCurrentSpending,
        budgetAlerts: subscription.smsBudgetAlerts,
      },
    };
  }

  /**
   * API 8: 查询订阅日志
   */
  async getLogs(orgId: string, query: GetLogsQuery) {
    const { page, pageSize, action } = query;
    const skip = (page - 1) * pageSize;

    // 先确认订阅存在
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

    // 构建筛选条件
    const where: any = {
      subscriptionId: subscription.id,
    };

    if (action) {
      where.action = action;
    }

    // 查询日志和总数
    const [logs, total] = await Promise.all([
      prisma.subscriptionLog.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.subscriptionLog.count({ where }),
    ]);

    return {
      logs: logs.map((log) => ({
        id: log.id,
        action: log.action,
        actorId: log.actorId,
        details: log.details,
        createdAt: log.createdAt,
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  // ========================================
  // 辅助方法
  // ========================================

  private async calculateResourceQuotas(subscription: any) {
    // 获取Standard Plan的基础配额
    const standardPlan = await prisma.standardPlan.findFirst({
      where: { status: 'ACTIVE' },
    });

    const baseQuotas = (standardPlan?.resourceQuotas as Record<string, number>) || {};
    const resources: Record<string, any> = {};

    // 初始化基础配额
    Object.entries(baseQuotas).forEach(([type, quota]) => {
      resources[type] = {
        type,
        base: quota,
        extra: 0,
        total: quota,
      };
    });

    // 添加额外购买的配额
    subscription.subscriptionResources.forEach((sr: any) => {
      const type = sr.resource.type;
      if (!resources[type]) {
        resources[type] = { type, base: 0, extra: 0, total: 0 };
      }
      resources[type].extra += sr.quantity;
      resources[type].total += sr.quantity;
    });

    return Object.values(resources);
  }

  private calculateMonthlyTotal(subscription: any): number {
    let total = subscription.standardPrice.toNumber();

    // 添加模块费用
    subscription.subscriptionModules.forEach((sm: any) => {
      if (sm.isActive && sm.module.monthlyPrice) {
        total += sm.module.monthlyPrice.toNumber();
      }
    });

    // 添加资源费用
    subscription.subscriptionResources.forEach((sr: any) => {
      if (!sr.removedAt) {
        total += sr.resource.monthlyPrice.toNumber() * sr.quantity;
      }
    });

    return total;
  }

  private getMonthlyBreakdown(subscription: any) {
    const breakdown: any = {
      standardPlan: subscription.standardPrice.toNumber(),
      modules: {},
      resources: {},
    };

    subscription.subscriptionModules.forEach((sm: any) => {
      if (sm.isActive && sm.module.monthlyPrice.toNumber() > 0) {
        breakdown.modules[sm.module.key] = sm.module.monthlyPrice.toNumber();
      }
    });

    subscription.subscriptionResources.forEach((sr: any) => {
      if (!sr.removedAt) {
        breakdown.resources[sr.resource.type] = {
          quantity: sr.quantity,
          unitPrice: sr.resource.monthlyPrice.toNumber(),
          total: sr.resource.monthlyPrice.toNumber() * sr.quantity,
        };
      }
    });

    return breakdown;
  }

  private calculateRemainingDays(futureDate: Date): number {
    const now = new Date();
    const diff = futureDate.getTime() - now.getTime();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  private getCurrentBillingPeriodStart(renewsAt: Date): Date {
    const periodStart = new Date(renewsAt);
    periodStart.setMonth(periodStart.getMonth() - 1);
    return periodStart;
  }

  private summarizeInvoiceItems(items: any): any {
    if (!items || typeof items !== 'object') {
      return { itemCount: 0 };
    }

    return {
      itemCount: Array.isArray(items) ? items.length : Object.keys(items).length,
      categories: items.categories || [],
    };
  }
}

// 导出单例
export const queryService = new QueryService();
