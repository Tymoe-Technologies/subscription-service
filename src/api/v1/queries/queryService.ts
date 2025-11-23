import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import { prisma } from '../../../infra/prisma.js';
import { stripe } from '../../../infra/stripe.js';
import { AppError } from '../../../utils/errors.js';
import { logger } from '../../../utils/logger.js';
import {
  OrgSubscriptionDetails,
  SubscriptionInfo,
  PermissionsInfo,
  TrialInfo,
} from '../../../types/query.js';

/**
 * 查询服务层
 * 处理组织订阅信息、权限和 Trial 资格的查询
 */
export class QueryService {
  private prisma: PrismaClient;
  private stripe: Stripe;

  constructor() {
    this.prisma = prisma;
    this.stripe = stripe;
  }

  /**
   * 获取组织的完整订阅信息
   * 包括订阅状态、权限列表和 Trial 资格
   */
  async getOrgSubscriptionDetails(
    orgId: string,
    userId?: string
  ): Promise<OrgSubscriptionDetails> {
    logger.info('获取组织订阅详情', { orgId, userId });

    // 1. 查询订阅记录
    const subscription = await this.prisma.subscription.findUnique({
      where: { orgId },
      select: {
        orgId: true,
        payerId: true,
        status: true,
        items: true,
        stripeSubscriptionId: true,
        stripeCustomerId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // 2. 查询用户的 Trial 状态（如果提供了 userId）
    let userTrialStatus = null;
    if (userId) {
      userTrialStatus = await this.prisma.userTrialStatus.findUnique({
        where: { userId },
        select: {
          hasUsedTrial: true,
          trialActivatedAt: true,
        },
      });
    }

    // 3. 如果没有订阅记录，返回空订阅状态
    if (!subscription) {
      logger.info('组织暂无订阅', { orgId });

      return {
        subscription: {
          status: 'none',
          planKey: null,
          planName: null,
          moduleKeys: [],
          trialEndsAt: null,
          currentPeriodEnd: null,
          stripeSubscriptionId: null,
          stripeCustomerId: null,
        },
        permissions: {
          features: [],
          includedModules: [],
        },
        trial: {
          hasUsedTrial: userTrialStatus?.hasUsedTrial || false,
          canStartTrial: !userTrialStatus?.hasUsedTrial,
          trialActivatedAt: userTrialStatus?.trialActivatedAt?.toISOString() || null,
        },
      };
    }

    // 4. 从 Stripe 获取订阅详细信息
    let stripeSubscription: Stripe.Subscription | null = null;
    try {
      stripeSubscription = await this.stripe.subscriptions.retrieve(
        subscription.stripeSubscriptionId
      );
    } catch (error) {
      logger.error('从 Stripe 获取订阅信息失败', {
        orgId,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        error,
      });
      // 继续执行，使用本地数据
    }

    // 5. 解析订阅项目
    const items = subscription.items as any;
    const subscriptionItems = Array.isArray(items) ? items : [];

    // 6. 提取 planKey 和 moduleKeys
    let planKey: string | null = null;
    let planName: string | null = null;
    const moduleKeys: string[] = [];

    for (const item of subscriptionItems) {
      if (item.type === 'plan') {
        planKey = item.key;
        planName = item.name;
      } else if (item.type === 'module') {
        moduleKeys.push(item.key);
      }
    }

    // 7. 查询 Plan 的详细信息（包含 includedModules）
    interface IncludedModule {
      moduleKey: string;
      quantity: number;
    }
    let planIncludedModules: IncludedModule[] = [];
    if (planKey) {
      const plan = await this.prisma.plan.findUnique({
        where: { key: planKey },
        select: {
          includedModules: true,
        },
      });

      if (plan) {
        planIncludedModules = (plan.includedModules as unknown as IncludedModule[]) || [];
      }
    }

    // 8. 合并所有可用的 Module keys（Plan 包含的 + 额外购买的）
    const includedModuleKeys = planIncludedModules.map(m => m.moduleKey);
    const allModuleKeys = Array.from(new Set([...includedModuleKeys, ...moduleKeys]));

    // 9. 查询所有 Module 的详细信息
    const modules = await this.prisma.module.findMany({
      where: {
        key: { in: allModuleKeys },
      },
      select: {
        key: true,
        name: true,
      },
    });

    // 10. 构建权限列表（简化版本，可根据实际业务扩展）
    const features: string[] = [];

    // 根据 Plan 添加基础功能
    if (planKey) {
      // 这里可以根据不同 Plan 定义不同功能
      // 示例：
      if (planKey === 'pro' || planKey === 'enterprise') {
        features.push('advanced-analytics', 'api-access');
      }
      if (planKey === 'enterprise') {
        features.push('sso', 'dedicated-support');
      }
    }

    // 根据 Module 添加功能
    modules.forEach((module) => {
      // 可以在这里根据 Module key 映射到具体功能
      // 示例：
      if (module.key === 'analytics') {
        features.push('data-export', 'custom-reports');
      }
      if (module.key === 'ai-assistant') {
        features.push('ai-chat', 'ai-suggestions');
      }
    });

    // 11. 构建订阅信息
    const subscriptionInfo: SubscriptionInfo = {
      status: subscription.status,
      planKey,
      planName,
      moduleKeys: allModuleKeys,
      trialEndsAt:
        stripeSubscription?.trial_end && stripeSubscription.status === 'trialing'
          ? new Date(stripeSubscription.trial_end * 1000).toISOString()
          : null,
      currentPeriodEnd: stripeSubscription?.current_period_end
        ? new Date(stripeSubscription.current_period_end * 1000).toISOString()
        : null,
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      stripeCustomerId: subscription.stripeCustomerId,
    };

    // 12. 构建权限信息
    const permissionsInfo: PermissionsInfo = {
      features: Array.from(new Set(features)), // 去重
      includedModules: allModuleKeys,
    };

    // 13. 构建 Trial 信息
    const trialInfo: TrialInfo = {
      hasUsedTrial: userTrialStatus?.hasUsedTrial || false,
      canStartTrial: !userTrialStatus?.hasUsedTrial,
      trialActivatedAt: userTrialStatus?.trialActivatedAt?.toISOString() || null,
    };

    logger.info('组织订阅详情查询成功', {
      orgId,
      status: subscription.status,
      planKey,
      moduleCount: allModuleKeys.length,
    });

    return {
      subscription: subscriptionInfo,
      permissions: permissionsInfo,
      trial: trialInfo,
    };
  }
}

export const queryService = new QueryService();
