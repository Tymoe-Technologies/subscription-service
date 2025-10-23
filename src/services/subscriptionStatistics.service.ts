import { prisma } from '../infra/prisma.js';
import { Prisma, SubscriptionStatus, InvoiceStatus } from '@prisma/client';
import {
  StatisticsQuery,
  ListSubscriptionsQuery,
} from '../validators/subscriptionStatistics.validators.js';

/**
 * 订阅统计服务
 * 提供管理员查看订阅统计和列表的功能
 */

export class SubscriptionStatisticsService {
  /**
   * 获取全局订阅统计
   */
  async getStatistics(query: StatisticsQuery) {
    // 默认统计本月数据
    const now = new Date();
    const from = query.from ? new Date(query.from) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = query.to ? new Date(query.to) : now;

    // 并行查询各项统计
    const [
      overview,
      revenue,
      conversion,
      trends,
      upcoming,
      paymentHealth,
      resourceUsage,
      paymentProviders,
    ] = await Promise.all([
      this.getOverview(),
      this.getRevenue(),
      this.getConversion(from, to),
      this.getTrends(from, to),
      this.getUpcoming(),
      this.getPaymentHealth(),
      this.getResourceUsage(),
      this.getPaymentProviders(),
    ]);

    return {
      overview,
      revenue,
      conversion,
      trends,
      upcoming,
      paymentHealth,
      resourceUsage,
      paymentProviders,
    };
  }

  /**
   * 订阅概览统计
   */
  private async getOverview() {
    const [total, active, trial, expired, suspended, cancelled] = await Promise.all([
      // 总订阅数（不含CANCELLED）
      prisma.subscription.count({
        where: { status: { not: 'CANCELLED' } },
      }),
      // ACTIVE状态订阅数
      prisma.subscription.count({
        where: { status: 'ACTIVE' },
      }),
      // TRIAL状态订阅数
      prisma.subscription.count({
        where: { status: 'TRIAL' },
      }),
      // EXPIRED状态订阅数
      prisma.subscription.count({
        where: { status: 'EXPIRED' },
      }),
      // SUSPENDED状态订阅数
      prisma.subscription.count({
        where: { status: 'SUSPENDED' },
      }),
      // CANCELLED状态订阅数（全部历史）
      prisma.subscription.count({
        where: { status: 'CANCELLED' },
      }),
    ]);

    return {
      totalSubscriptions: total,
      activeSubscriptions: active,
      trialSubscriptions: trial,
      expiredSubscriptions: expired,
      suspendedSubscriptions: suspended,
      cancelledSubscriptions: cancelled,
    };
  }

  /**
   * 收入指标统计
   */
  private async getRevenue() {
    // 查询所有ACTIVE订阅的standardPrice
    const activeSubscriptions = await prisma.subscription.findMany({
      where: { status: 'ACTIVE' },
      select: { standardPrice: true },
    });

    const mrr = activeSubscriptions.reduce(
      (sum, sub) => sum + Number(sub.standardPrice),
      0
    );

    const arpu = activeSubscriptions.length > 0 ? mrr / activeSubscriptions.length : 0;

    // 潜在月收入（包含TRIAL转化后的收入）
    const trialSubscriptions = await prisma.subscription.findMany({
      where: { status: 'TRIAL' },
      select: { standardPrice: true },
    });

    const trialPotential = trialSubscriptions.reduce(
      (sum, sub) => sum + Number(sub.standardPrice),
      0
    );

    return {
      monthlyRecurringRevenue: Number(mrr.toFixed(2)),
      averageRevenuePerUser: Number(arpu.toFixed(2)),
      totalMonthlyPotential: Number((mrr + trialPotential).toFixed(2)),
    };
  }

  /**
   * 转化指标统计
   */
  private async getConversion(from: Date, to: Date) {
    // 本期从TRIAL转为ACTIVE的订阅数（通过subscription_logs查询）
    const trialToActiveCount = await prisma.subscriptionLog.count({
      where: {
        action: 'STATUS_CHANGE',
        createdAt: { gte: from, lte: to },
        details: {
          path: ['from'],
          equals: 'TRIAL',
        },
      },
    });

    // 本期开始的试用总数
    const totalTrialStarted = await prisma.subscription.count({
      where: {
        status: 'TRIAL',
        createdAt: { gte: from, lte: to },
      },
    });

    // 本期结束的试用总数
    const totalTrialEnded = await prisma.subscription.count({
      where: {
        trialEndsAt: { gte: from, lte: to },
      },
    });

    const conversionRate =
      totalTrialStarted > 0 ? (trialToActiveCount / totalTrialStarted) * 100 : 0;

    return {
      trialToActiveCount,
      trialToActiveRate: Number(conversionRate.toFixed(2)),
      totalTrialStarted,
      totalTrialEnded,
    };
  }

  /**
   * 趋势数据统计
   */
  private async getTrends(from: Date, to: Date) {
    const now = new Date();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [newMonth, newWeek, newToday, cancelMonth] = await Promise.all([
      // 本月新增订阅数
      prisma.subscription.count({
        where: { createdAt: { gte: from, lte: to } },
      }),
      // 本周新增订阅数
      prisma.subscription.count({
        where: { createdAt: { gte: weekStart, lte: now } },
      }),
      // 今日新增订阅数
      prisma.subscription.count({
        where: { createdAt: { gte: todayStart, lte: now } },
      }),
      // 本月取消订阅数
      prisma.subscription.count({
        where: {
          status: 'CANCELLED',
          cancelledAt: { gte: from, lte: to },
        },
      }),
    ]);

    const totalActive = await prisma.subscription.count({
      where: { status: { in: ['TRIAL', 'ACTIVE'] } },
    });

    const cancellationRate = totalActive > 0 ? (cancelMonth / totalActive) * 100 : 0;

    return {
      newSubscriptionsThisMonth: newMonth,
      newSubscriptionsThisWeek: newWeek,
      newSubscriptionsToday: newToday,
      cancellationsThisMonth: cancelMonth,
      cancellationRate: Number(cancellationRate.toFixed(2)),
      netGrowthThisMonth: newMonth - cancelMonth,
    };
  }

  /**
   * 即将发生的事件统计
   */
  private async getUpcoming() {
    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    const [renewing7, renewing30, trialExpiring7, trialExpiringToday, inGracePeriod] =
      await Promise.all([
        // 7天内需续费的订阅数
        prisma.subscription.count({
          where: {
            status: 'ACTIVE',
            renewsAt: { gte: now, lte: in7Days },
          },
        }),
        // 30天内需续费的订阅数
        prisma.subscription.count({
          where: {
            status: 'ACTIVE',
            renewsAt: { gte: now, lte: in30Days },
          },
        }),
        // 7天内试用到期的订阅数
        prisma.subscription.count({
          where: {
            status: 'TRIAL',
            trialEndsAt: { gte: now, lte: in7Days },
          },
        }),
        // 今日试用到期的订阅数
        prisma.subscription.count({
          where: {
            status: 'TRIAL',
            trialEndsAt: { gte: now, lte: todayEnd },
          },
        }),
        // 宽限期内的订阅数
        prisma.subscription.count({
          where: {
            gracePeriodEndsAt: { gte: now },
          },
        }),
      ]);

    return {
      subscriptionsRenewingIn7Days: renewing7,
      subscriptionsRenewingIn30Days: renewing30,
      trialsExpiringIn7Days: trialExpiring7,
      trialsExpiringToday: trialExpiringToday,
      subscriptionsInGracePeriod: inGracePeriod,
    };
  }

  /**
   * 支付健康度统计
   */
  private async getPaymentHealth() {
    const [failedInvoices, pendingInvoices, paidInvoices] = await Promise.all([
      // 失败发票统计
      prisma.invoice.aggregate({
        where: { status: 'FAILED' },
        _count: true,
        _sum: { total: true },
      }),
      // 待支付发票统计
      prisma.invoice.aggregate({
        where: { status: 'PENDING' },
        _count: true,
        _sum: { total: true },
      }),
      // 已支付发票统计
      prisma.invoice.aggregate({
        where: { status: 'PAID' },
        _count: true,
      }),
    ]);

    const totalInvoices = failedInvoices._count + pendingInvoices._count + paidInvoices._count;
    const successRate = totalInvoices > 0 ? (paidInvoices._count / totalInvoices) * 100 : 0;

    return {
      failedInvoicesCount: failedInvoices._count,
      failedInvoicesAmount: Number(failedInvoices._sum.total || 0),
      pendingInvoicesCount: pendingInvoices._count,
      pendingInvoicesAmount: Number(pendingInvoices._sum.total || 0),
      successRate: Number(successRate.toFixed(2)),
    };
  }

  /**
   * 资源使用统计
   */
  private async getResourceUsage() {
    const [moduleStats, resourceStats, activeSubscriptions] = await Promise.all([
      // 总模块订阅数量
      prisma.subscriptionModule.count({
        where: {
          isActive: true,
          removedAt: null,
        },
      }),
      // 总额外资源购买数量（quantity总和）
      prisma.subscriptionResource.aggregate({
        where: { removedAt: null },
        _sum: { quantity: true },
      }),
      // 活跃订阅数
      prisma.subscription.count({
        where: { status: { in: ['TRIAL', 'ACTIVE'] } },
      }),
    ]);

    return {
      totalModuleSubscriptions: moduleStats,
      totalExtraResources: resourceStats._sum.quantity || 0,
      averageModulesPerSubscription:
        activeSubscriptions > 0
          ? Number((moduleStats / activeSubscriptions).toFixed(2))
          : 0,
      averageExtraResourcesPerSubscription:
        activeSubscriptions > 0
          ? Number(
              ((resourceStats._sum.quantity || 0) / activeSubscriptions).toFixed(2)
            )
          : 0,
    };
  }

  /**
   * 支付方式分布统计
   */
  private async getPaymentProviders() {
    const [stripe, paypal, none] = await Promise.all([
      prisma.subscription.count({
        where: { paymentProvider: 'stripe' },
      }),
      prisma.subscription.count({
        where: { paymentProvider: 'paypal' },
      }),
      prisma.subscription.count({
        where: { paymentProvider: null },
      }),
    ]);

    return {
      stripe,
      paypal,
      none,
    };
  }

  /**
   * 列出订阅（分页、筛选、排序）
   */
  async listSubscriptions(query: ListSubscriptionsQuery) {
    const { page, limit, sortBy, order, ...filters } = query;

    // 构建where条件
    const where = this.buildWhereClause(filters);

    // 查询总数和数据
    const [total, items] = await Promise.all([
      prisma.subscription.count({ where }),
      prisma.subscription.findMany({
        where,
        orderBy: { [sortBy]: order },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          subscriptionModules: {
            where: {
              isActive: true,
              removedAt: null,
            },
            include: {
              module: {
                select: { key: true, name: true },
              },
            },
          },
          subscriptionResources: {
            where: { removedAt: null },
            include: {
              resource: {
                select: { type: true, name: true },
              },
            },
          },
          usages: {
            where: {
              createdAt: {
                gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
              },
            },
            select: {
              amount: true,
              isFree: true,
              billedAt: true,
              usageType: true,
              quantity: true,
            },
          },
          invoices: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              number: true,
              total: true,
              status: true,
              createdAt: true,
            },
          },
        },
      }),
    ]);

    // 获取当前ACTIVE的StandardPlan配置（用于试用短信quota）
    const activeStandardPlan = await prisma.standardPlan.findFirst({
      where: { status: 'ACTIVE' },
      select: { trialSmsQuota: true },
    });

    // 处理订阅数据
    const processedItems = items.map((sub) => {
      // 模块摘要
      const modules = {
        total: sub.subscriptionModules.length,
        active: sub.subscriptionModules.filter((m) => m.isActive).length,
        topModules: sub.subscriptionModules
          .slice(0, 3)
          .map((m) => m.module.key),
      };

      // 额外资源摘要
      const extraResources = {
        total: sub.subscriptionResources.reduce((sum, r) => sum + r.quantity, 0),
        byType: sub.subscriptionResources.reduce(
          (acc, r) => {
            acc[r.resource.type] = (acc[r.resource.type] || 0) + r.quantity;
            return acc;
          },
          {} as Record<string, number>
        ),
      };

      // 使用量摘要（本月）
      const currentMonthUsage = {
        totalAmount: sub.usages.reduce((sum, u) => sum + Number(u.amount), 0),
        smsCount: sub.usages
          .filter((u) => u.usageType === 'sms_send')
          .reduce((sum, u) => sum + u.quantity, 0),
        unbilledAmount: sub.usages
          .filter((u) => !u.billedAt)
          .reduce((sum, u) => sum + Number(u.amount), 0),
      };

      // 试用短信
      const trialSms = {
        used: sub.trialSmsUsed,
        quota: activeStandardPlan?.trialSmsQuota || 100,
        enabled: sub.trialSmsEnabled,
      };

      // 短信预算
      const smsBudget = {
        monthlyBudget: sub.smsMonthlyBudget ? Number(sub.smsMonthlyBudget) : null,
        currentSpending: Number(sub.smsCurrentSpending),
        percentage: sub.smsMonthlyBudget
          ? Number(
              (
                (Number(sub.smsCurrentSpending) / Number(sub.smsMonthlyBudget)) *
                100
              ).toFixed(2)
            )
          : null,
        alerts: (sub.smsBudgetAlerts as string[]) || [],
      };

      // 最近发票
      const lastInvoice = sub.invoices[0]
        ? {
            id: sub.invoices[0].id,
            number: sub.invoices[0].number,
            total: Number(sub.invoices[0].total),
            status: sub.invoices[0].status,
            createdAt: sub.invoices[0].createdAt.toISOString(),
          }
        : null;

      // 取消信息
      const cancellation =
        sub.status === 'CANCELLED' && sub.cancelledAt
          ? {
              reason: sub.cancelReason || '',
              cancelledAt: sub.cancelledAt.toISOString(),
            }
          : null;

      return {
        // 基本信息
        id: sub.id,
        orgId: sub.orgId,
        payerId: sub.payerId,
        status: sub.status,
        billingCycle: sub.billingCycle,
        standardPrice: Number(sub.standardPrice),
        autoRenew: sub.autoRenew,

        // 时间信息
        startedAt: sub.startedAt?.toISOString() || null,
        renewsAt: sub.renewsAt?.toISOString() || null,
        trialEndsAt: sub.trialEndsAt?.toISOString() || null,
        gracePeriodEndsAt: sub.gracePeriodEndsAt?.toISOString() || null,
        cancelledAt: sub.cancelledAt?.toISOString() || null,
        createdAt: sub.createdAt.toISOString(),
        updatedAt: sub.updatedAt.toISOString(),

        // 支付信息
        paymentProvider: sub.paymentProvider,
        paymentLast4: sub.paymentLast4,

        // 摘要信息
        trialSms,
        smsBudget,
        modules,
        extraResources,
        currentMonthUsage,
        lastInvoice,
        cancellation,
      };
    });

    // 当前页摘要
    const summary = {
      totalStandardPrice: items.reduce(
        (sum, sub) => sum + Number(sub.standardPrice),
        0
      ),
      averageStandardPrice:
        items.length > 0
          ? items.reduce((sum, sub) => sum + Number(sub.standardPrice), 0) / items.length
          : 0,
    };

    return {
      items: processedItems,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      summary: {
        totalStandardPrice: Number(summary.totalStandardPrice.toFixed(2)),
        averageStandardPrice: Number(summary.averageStandardPrice.toFixed(2)),
      },
    };
  }

  /**
   * 构建where查询条件
   */
  private buildWhereClause(filters: Partial<ListSubscriptionsQuery>): Prisma.SubscriptionWhereInput {
    const where: Prisma.SubscriptionWhereInput = {};

    // 状态筛选
    if (filters.status) {
      where.status = filters.status as SubscriptionStatus;
    }

    // ID搜索
    if (filters.orgId) {
      where.orgId = filters.orgId;
    }
    if (filters.payerId) {
      where.payerId = filters.payerId;
    }

    // 支付方式筛选
    if (filters.paymentProvider) {
      if (filters.paymentProvider === 'none') {
        where.paymentProvider = null;
      } else {
        where.paymentProvider = filters.paymentProvider;
      }
    }

    // 自动续费筛选
    if (filters.autoRenew !== undefined) {
      where.autoRenew = filters.autoRenew;
    }

    // 时间范围筛选
    if (filters.createdFrom || filters.createdTo) {
      where.createdAt = {};
      if (filters.createdFrom) {
        where.createdAt.gte = new Date(filters.createdFrom);
      }
      if (filters.createdTo) {
        where.createdAt.lte = new Date(filters.createdTo);
      }
    }

    if (filters.renewsFrom || filters.renewsTo) {
      where.renewsAt = {};
      if (filters.renewsFrom) {
        where.renewsAt.gte = new Date(filters.renewsFrom);
      }
      if (filters.renewsTo) {
        where.renewsAt.lte = new Date(filters.renewsTo);
      }
    }

    if (filters.trialEndsFrom || filters.trialEndsTo) {
      where.trialEndsAt = {};
      if (filters.trialEndsFrom) {
        where.trialEndsAt.gte = new Date(filters.trialEndsFrom);
      }
      if (filters.trialEndsTo) {
        where.trialEndsAt.lte = new Date(filters.trialEndsTo);
      }
    }

    // 价格范围筛选
    if (filters.priceMin !== undefined || filters.priceMax !== undefined) {
      where.standardPrice = {};
      if (filters.priceMin !== undefined) {
        where.standardPrice.gte = filters.priceMin;
      }
      if (filters.priceMax !== undefined) {
        where.standardPrice.lte = filters.priceMax;
      }
    }

    return where;
  }
}

// 导出单例
export const subscriptionStatisticsService = new SubscriptionStatisticsService();
