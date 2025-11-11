import { prisma } from '../infra/prisma.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import {
  CancelReason,
  CancelReasonDisplay,
  ActivationType,
  ResourceType,
} from '../types/index.js';
import type {
  CreateTrialSubscriptionRequest,
  SubscriptionItem,
  ActivateSubscriptionRequest,
  CalculatePriceRequest,
  CancelSubscriptionRequest,
  UpdatePaymentMethodRequest,
  UpdateSmsBudgetRequest,
} from '../validators/subscription.validators.js';
import Stripe from 'stripe';
import { stripeService } from '../infra/stripe.js';

// 初始化Stripe客户端 (需要在config中配置)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16',
});

/**
 * 订阅管理Service
 * Part 2: 订阅管理API业务逻辑
 */
export class SubscriptionService {
  // ========================================
  // 工具方法
  // ========================================

  /**
   * 计算下次续费日期（Billing Anchor Day逻辑）
   * 参考Stripe处理月份天数差异的方式
   */
  private calculateNextRenewal(anchorDay: number, fromDate: Date): Date {
    const nextMonth = new Date(fromDate);
    nextMonth.setMonth(nextMonth.getMonth() + 1);

    // 获取下个月的最后一天
    const lastDayOfNextMonth = new Date(
      nextMonth.getFullYear(),
      nextMonth.getMonth() + 1,
      0
    ).getDate();

    // 如果anchorDay > 下个月天数，使用最后一天
    const billingDay = Math.min(anchorDay, lastDayOfNextMonth);

    return new Date(nextMonth.getFullYear(), nextMonth.getMonth(), billingDay, 0, 0, 0, 0);
  }

  /**
   * 计算按天计费金额
   */
  private calculateProratedCharge(monthlyPrice: number, daysRemaining: number): number {
    const dailyRate = monthlyPrice / 30;
    return parseFloat((dailyRate * daysRemaining).toFixed(2));
  }

  /**
   * 计算两个日期之间的天数差
   */
  private daysBetween(date1: Date, date2: Date): number {
    const oneDay = 24 * 60 * 60 * 1000;
    return Math.round(Math.abs((date1.getTime() - date2.getTime()) / oneDay));
  }

  /**
   * 获取当前月剩余天数
   */
  private getDaysRemainingInPeriod(periodEnd: Date): number {
    return this.daysBetween(new Date(), periodEnd);
  }

  /**
   * 检查订阅是否启用了特定模块
   * @param organizationId - 组织ID
   * @param moduleCode - 模块代码 (e.g., 'sms', 'email')
   * @returns 如果模块已启用返回true，否则返回false
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
        subscriptionModules: {  // 正确的关联名
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

  // ========================================
  // API 1: 创建订阅 (智能检测：首次用户→TRIAL，已用过→ACTIVE)
  // ========================================
  /**
   * 创建订阅 - 智能检测用户Trial资格
   *
   * 支持两种格式：
   * 1. 旧格式（向后兼容）: organizationIds数组 - 所有org使用Standard Plan
   * 2. 新格式: requestData.items数组 - 每个org可自定义额外模块和资源
   *
   * 智能检测逻辑（per-user，一次性机会）：
   * - 首次订阅（hasUsedTrial=false）→ 创建TRIAL订阅（30天免费）
   * - 已用过Trial（hasUsedTrial=true）→ 创建ACTIVE订阅（立即扣费）
   *
   * 流程：
   * 1. 检查用户Trial资格，决定创建TRIAL还是ACTIVE订阅
   * 2. 检查选中org是否已有活跃订阅
   * 3. 创建订阅记录（状态根据Trial资格决定）
   * 4. 首次用户：标记hasUsedTrial=true
   * 5. 创建Stripe Checkout/Subscription
   */
  async createTrial(
    requestData: CreateTrialSubscriptionRequest,
    payerId: string,
    organizations: Array<{ id: string; orgType?: string; name?: string; email?: string }>
  ) {
    // 1. 判断使用哪种格式并标准化为items格式
    let items: SubscriptionItem[];

    if ('organizationIds' in requestData) {
      // 旧格式：转换为items格式
      items = requestData.organizationIds.map((orgId) => ({
        organizationId: orgId,
        additionalModules: [],
        additionalResources: [],
      }));
    } else {
      // 新格式：直接使用
      items = requestData.items;
    }

    // 2. 提取所有organizationIds
    const organizationIds = items.map((item) => item.organizationId);

    // 3. 检查用户Trial资格（per-user，决定创建TRIAL还是ACTIVE订阅）
    const userTrialStatus = await prisma.userTrialStatus.findUnique({
      where: { userId: payerId },
    });

    const isFirstTimeUser = !userTrialStatus || !userTrialStatus.hasUsedTrial;
    const subscriptionStatus = isFirstTimeUser ? 'TRIAL' : 'ACTIVE';

    console.log(`[createTrial] User ${payerId} Trial eligibility check:`, {
      isFirstTimeUser,
      subscriptionStatus,
      hasUsedTrial: userTrialStatus?.hasUsedTrial,
      trialActivatedAt: userTrialStatus?.trialActivatedAt,
    });

    // 4. 验证organizationIds都属于该用户
    // 注意：所有组织类型（MAIN、BRANCH、FRANCHISE）都允许订阅
    // 订阅状态（TRIAL或ACTIVE）仅由用户的hasUsedTrial决定
    const orgMap = new Map(organizations.map((org) => [org.id, org]));

    for (const orgId of organizationIds) {
      const org = orgMap.get(orgId);

      if (!org) {
        throw new AppError(
          'ORGANIZATION_NOT_FOUND',
          `Organization ${orgId} not found for user`,
          404,
          { orgId, userId: payerId }
        );
      }

      // 不再限制组织类型，所有类型都可以订阅
    }

    // 5. 检查是否有重复的organizationId
    const uniqueOrgIds = new Set(organizationIds);
    if (uniqueOrgIds.size !== organizationIds.length) {
      throw new AppError(
        'DUPLICATE_ORGANIZATIONS',
        'Duplicate organization IDs provided',
        400
      );
    }

    // 6. 获取ACTIVE StandardPlan
    const standardPlan = await prisma.standardPlan.findFirst({
      where: { status: 'ACTIVE' },
    });

    if (!standardPlan) {
      throw new AppError(
        'STANDARD_PLAN_NOT_FOUND',
        'No active Standard Plan configuration found',
        404
      );
    }

    // 7. 收集所有需要的模块keys（Standard Plan + 所有item的额外模块）
    const baseModuleKeys = standardPlan.includedModuleKeys as string[];
    const allAdditionalModuleKeys = new Set<string>();

    for (const item of items) {
      for (const moduleKey of item.additionalModules || []) {
        allAdditionalModuleKeys.add(moduleKey);
      }
    }

    const allModuleKeys = [...new Set([...baseModuleKeys, ...allAdditionalModuleKeys])];

    // 8. 验证所有模块有效性
    const allModules = await prisma.module.findMany({
      where: {
        key: { in: allModuleKeys },
        status: 'ACTIVE',
      },
    });

    if (allModules.length !== allModuleKeys.length) {
      const foundKeys = allModules.map((m) => m.key);
      const missingKeys = allModuleKeys.filter((k) => !foundKeys.includes(k));

      throw new AppError('INVALID_MODULE_KEYS', 'Some module keys are invalid or inactive', 400, {
        missingKeys,
      });
    }

    // 创建moduleKey到module对象的映射
    const moduleMap = new Map(allModules.map((m) => [m.key, m]));
    const baseModules = baseModuleKeys.map((key) => moduleMap.get(key)!);

    // 9. 收集所有需要的资源类型
    const allResourceTypes = new Set<string>();
    for (const item of items) {
      for (const res of item.additionalResources || []) {
        allResourceTypes.add(res.resourceType);
      }
    }

    // 10. 验证所有资源类型有效性
    let allResources: any[] = [];
    if (allResourceTypes.size > 0) {
      allResources = await prisma.resource.findMany({
        where: {
          type: { in: Array.from(allResourceTypes) },
          status: 'ACTIVE',
        },
      });

      if (allResources.length !== allResourceTypes.size) {
        const foundTypes = allResources.map((r) => r.type);
        const missingTypes = Array.from(allResourceTypes).filter((t) => !foundTypes.includes(t));

        throw new AppError('INVALID_RESOURCE_TYPES', 'Some resource types are invalid or inactive', 400, {
          missingTypes,
        });
      }
    }

    // 创建resourceType到resource对象的映射
    const resourceMap = new Map(allResources.map((r) => [r.type, r]));

    // 11. 计算每个item的总价（用于Stripe）
    const itemsWithPricing = items.map((item) => {
      // 将Decimal转为number进行计算
      let itemTotal = Number(standardPlan.monthlyPrice);

      // 额外模块费用
      for (const moduleKey of item.additionalModules || []) {
        const module = moduleMap.get(moduleKey);
        if (module) {
          itemTotal += Number(module.monthlyPrice);
        }
      }

      // 额外资源费用
      for (const res of item.additionalResources || []) {
        const resource = resourceMap.get(res.resourceType);
        if (resource) {
          itemTotal += Number(resource.monthlyPrice) * res.quantity;
        }
      }

      return {
        ...item,
        monthlyPrice: itemTotal,
      };
    });

    // 总价（所有org的总和）
    const totalMonthlyPrice = itemsWithPricing.reduce((sum, item) => sum + item.monthlyPrice, 0);

    // 12. 使用事务原子执行所有操作
    const now = new Date();
    const trialEndsAt = new Date(now);
    trialEndsAt.setDate(trialEndsAt.getDate() + standardPlan.trialDurationDays);

    const result = await prisma.$transaction(async (tx) => {
      // 12.1 检查所有organizationIds的订阅历史（包括当前订阅和历史订阅）
      const existingSubscriptions = await tx.subscription.findMany({
        where: {
          orgId: { in: organizationIds },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      // 检查是否有活跃订阅（TRIAL或ACTIVE状态）
      const activeSubscriptions = existingSubscriptions.filter(
        (s) => s.status === 'TRIAL' || s.status === 'ACTIVE'
      );

      if (activeSubscriptions.length > 0) {
        const activeOrgIds = activeSubscriptions.map((s) => s.orgId);
        throw new AppError(
          'SUBSCRIPTION_ALREADY_EXISTS',
          'Some organizations already have active subscriptions. Please manage existing subscriptions first.',
          400,
          { activeOrgIds, existingStatus: activeSubscriptions.map(s => s.status) }
        );
      }

      // 12.2 批量创建订阅（每个org可能有不同价格，状态根据用户Trial资格决定）
      const subscriptions = await Promise.all(
        itemsWithPricing.map(async (item) => {
          return await tx.subscription.create({
            data: {
              orgId: item.organizationId,
              payerId,
              status: subscriptionStatus, // TRIAL（首次用户）或 ACTIVE（已用过Trial）
              billingCycle: 'monthly',
              startedAt: now,
              trialEndsAt: subscriptionStatus === 'TRIAL' ? trialEndsAt : null,
              renewsAt: trialEndsAt, // Trial和ACTIVE都需要续费日期
              standardPrice: item.monthlyPrice, // 每个org的价格（Standard + 额外配置）
              trialSmsEnabled: subscriptionStatus === 'TRIAL',
              trialSmsUsed: 0,
              autoRenew: true,
              smsMonthlyBudget: null,
              smsCurrentSpending: 0,
              smsBudgetAlerts: [],
              smsNotifyByEmail: false, // 默认关闭，需要用户手动开启
              smsNotifyBySms: false, // 默认关闭，需要用户手动开启
            },
          });
        })
      );

      // 12.3 为每个订阅创建模块关联（Standard Plan基础模块 + 额外模块）
      for (let i = 0; i < subscriptions.length; i++) {
        const subscription = subscriptions[i];
        const item = itemsWithPricing[i];

        // 创建一个Set来追踪已添加的moduleId,避免重复
        const addedModuleIds = new Set<string>();
        const allModulesData: Array<{
          subscriptionId: string;
          moduleId: string;
          isActive: boolean;
          addedAt: Date;
        }> = [];

        // 先添加基础模块（来自Standard Plan）
        for (const m of baseModules) {
          if (!addedModuleIds.has(m.id)) {
            addedModuleIds.add(m.id);
            allModulesData.push({
              subscriptionId: subscription.id,
              moduleId: m.id,
              isActive: true,
              addedAt: now,
            });
          }
        }

        // 再添加额外模块（过滤掉已包含在Standard Plan中的）
        for (const moduleKey of item.additionalModules || []) {
          const module = moduleMap.get(moduleKey);
          if (module && !addedModuleIds.has(module.id)) {
            addedModuleIds.add(module.id);
            allModulesData.push({
              subscriptionId: subscription.id,
              moduleId: module.id,
              isActive: true,
              addedAt: now,
            });
          } else if (module && addedModuleIds.has(module.id)) {
            // 记录被过滤的重复模块
            logger.warn('Duplicate module filtered', {
              organizationId: item.organizationId,
              moduleKey,
              reason: 'Already included in Standard Plan',
            });
          }
        }

        // 批量创建模块关联
        if (allModulesData.length > 0) {
          await tx.subscriptionModule.createMany({
            data: allModulesData,
          });
        }
      }

      // 12.4 为每个订阅创建资源关联（如果有额外资源）
      for (let i = 0; i < subscriptions.length; i++) {
        const subscription = subscriptions[i];
        const item = itemsWithPricing[i];

        if (item.additionalResources && item.additionalResources.length > 0) {
          const resourcesData = item.additionalResources.map((res) => {
            const resource = resourceMap.get(res.resourceType)!;
            return {
              subscriptionId: subscription.id,
              resourceId: resource.id,
              quantity: res.quantity,
              addedAt: now,
            };
          });

          await tx.subscriptionResource.createMany({
            data: resourcesData,
          });
        }
      }

      // 12.5 为每个订阅创建日志
      for (let i = 0; i < subscriptions.length; i++) {
        const subscription = subscriptions[i];
        const item = itemsWithPricing[i];

        await tx.subscriptionLog.create({
          data: {
            subscriptionId: subscription.id,
            action: subscriptionStatus === 'TRIAL' ? 'TRIAL_STARTED' : 'SUBSCRIPTION_STARTED',
            actorId: payerId,
            details: {
              subscriptionType: subscriptionStatus,
              standardPlanId: standardPlan.id,
              standardPlanVersion: standardPlan.version,
              trialDurationDays: standardPlan.trialDurationDays,
              trialSmsQuota: standardPlan.trialSmsQuota,
              baseModuleKeys: baseModuleKeys,
              additionalModuleKeys: item.additionalModules || [],
              resourceQuotas: standardPlan.resourceQuotas,
              additionalResources: item.additionalResources || [],
              monthlyPrice: item.monthlyPrice,
              isFirstTimeUser,
            },
          },
        });
      }

      // 12.6 更新或创建UserTrialStatus（仅首次用户需要标记）
      if (isFirstTimeUser) {
        await tx.userTrialStatus.upsert({
          where: { userId: payerId },
          update: {
            hasUsedTrial: true,
            trialActivatedAt: now,
            initialTrialOrgIds: organizationIds,
            updatedAt: now,
          },
          create: {
            userId: payerId,
            hasUsedTrial: true,
            trialActivatedAt: now,
            initialTrialOrgIds: organizationIds,
          },
        });
      }

      return { subscriptions };
    });

    // 13. 获取或创建Stripe Customer (by user，复用已有Customer)
    // 查找用户是否已有订阅（任意组织）
    const existingSubscription = await prisma.subscription.findFirst({
      where: { 
        payerId: payerId,
        providerCustomerId: { not: null }
      },
      select: { providerCustomerId: true }
    });

    let customerId: string;
    if (existingSubscription?.providerCustomerId) {
      // 复用现有Customer
      customerId = existingSubscription.providerCustomerId;
      logger.info('Reusing existing Stripe Customer', {
        payerId,
        customerId,
        organizationIds
      });
    } else {
      // 首次订阅，创建新Customer
      const firstOrg = orgMap.get(organizationIds[0])!;
      const customer = await stripeService.createCustomer({
        name: firstOrg.name || `User ${payerId}`,
        email: firstOrg.email,
        metadata: {
          payerId,
          primaryOrganizationId: organizationIds[0],
          organizationIds: organizationIds.join(','),
          organizationCount: organizationIds.length,
          totalMonthlyPrice: totalMonthlyPrice.toString(),
          orgName: firstOrg.name,
          orgType: firstOrg.orgType,
        },
      });
      customerId = customer.id;
      logger.info('Created new Stripe Customer', {
        payerId,
        customerId,
        organizationIds
      });
    }

    // 14. 获取配置
    const STANDARD_PLAN_PRICE_ID = process.env.STRIPE_STANDARD_PLAN_PRICE_ID || 'price_standard_plan_monthly';
    const DEFAULT_SUCCESS_URL = process.env.STRIPE_SUCCESS_URL || 'https://tymoe.com/success?session_id={CHECKOUT_SESSION_ID}';
    const DEFAULT_CANCEL_URL = process.env.STRIPE_CANCEL_URL || 'https://tymoe.com/cancel';

    // 15. 创建Stripe Checkout Session (带Trial)
    // 注意：目前使用固定的Standard Plan Price ID，未来可能需要支持动态定价
    const checkoutSession = await stripeService.createCheckoutSession({
      customerId: customerId,
      priceId: STANDARD_PLAN_PRICE_ID,
      successUrl: DEFAULT_SUCCESS_URL,
      cancelUrl: DEFAULT_CANCEL_URL,
      trialEnd: Math.floor(trialEndsAt.getTime() / 1000), // Stripe使用Unix timestamp
      metadata: {
        payerId,
        primaryOrganizationId: organizationIds[0],
        organizationIds: organizationIds.join(','),
        subscriptionIds: result.subscriptions.map(s => s.id).join(','),
        totalMonthlyPrice: totalMonthlyPrice.toString(),
        itemsCount: items.length,
      },
    });

    // 16. 更新所有订阅记录，保存Customer信息和Checkout Session ID
    await prisma.$transaction(async (tx) => {
      // 更新所有订阅，保存Stripe Customer ID (复用或新建的都用同一个)
      for (const subscription of result.subscriptions) {
        await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            paymentProvider: 'stripe',
            providerCustomerId: customerId,
            providerMetadata: {
              stripeCustomerId: customerId,
              checkoutSessionId: checkoutSession.id,
              checkoutSessionStatus: 'pending',
            },
            updatedAt: new Date(),
          },
        });

        // 创建日志
        await tx.subscriptionLog.create({
          data: {
            subscriptionId: subscription.id,
            action: 'CHECKOUT_SESSION_CREATED',
            actorId: payerId,
            details: {
              checkoutSessionId: checkoutSession.id,
              checkoutSessionUrl: checkoutSession.url,
              stripeCustomerId: customerId,
              trialEndsAt,
              priceId: STANDARD_PLAN_PRICE_ID,
            },
          },
        });
      }
    });

    // 17. 返回Checkout URL供前端跳转
    return {
      checkoutUrl: checkoutSession.url!,
      sessionId: checkoutSession.id,
      expiresAt: new Date(checkoutSession.expires_at * 1000),
      subscriptions: result.subscriptions.map((sub, index) => {
        const item = itemsWithPricing[index];
        return {
          id: sub.id,
          organizationId: sub.orgId,
          status: sub.status,
          startedAt: sub.startedAt,
          trialEndsAt: sub.trialEndsAt,
          monthlyPrice: item.monthlyPrice,
          configuration: {
            baseModules: baseModuleKeys,
            additionalModules: item.additionalModules || [],
            additionalResources: item.additionalResources || [],
          },
        };
      }),
      pricing: {
        totalMonthlyPrice,
        currency: 'CAD',
        breakdown: itemsWithPricing.map((item) => ({
          organizationId: item.organizationId,
          standardPlanPrice: standardPlan.monthlyPrice,
          additionalModulesPrice: (item.additionalModules || []).reduce((sum, moduleKey) => {
            const module = moduleMap.get(moduleKey);
            return sum + (module ? module.monthlyPrice : 0);
          }, 0),
          additionalResourcesPrice: (item.additionalResources || []).reduce((sum, res) => {
            const resource = resourceMap.get(res.resourceType);
            return sum + (resource ? resource.monthlyPrice * res.quantity : 0);
          }, 0),
          totalPrice: item.monthlyPrice,
        })),
      },
      userTrialStatus: {
        userId: payerId,
        hasUsedTrial: true,
        trialActivatedAt: now,
        initialTrialOrgIds: organizationIds,
      },
      trialInfo: {
        durationDays: standardPlan.trialDurationDays,
        expiresAt: trialEndsAt,
        smsQuota: standardPlan.trialSmsQuota,
      },
      message: 'Please complete payment setup on Stripe checkout page. You will be charged after trial ends.',
    };
  }

  // ========================================
  // 新增 API: 计算订阅价格 (无状态、无数据库写入)
  // ========================================
  /**
   * 计算订阅价格 - 实时预览订阅费用
   *
   * 无状态计算,不写数据库
   * 用于前端购物车实时显示价格
   */
  async calculatePrice(requestData: CalculatePriceRequest) {
    const { items, couponCode, billingCycle } = requestData;

    // 1. 获取ACTIVE StandardPlan
    const standardPlan = await prisma.standardPlan.findFirst({
      where: { status: 'ACTIVE' },
    });

    if (!standardPlan) {
      throw new AppError(
        'STANDARD_PLAN_NOT_FOUND',
        'No active Standard Plan configuration found',
        404
      );
    }

    // 2. 收集所有需要的模块keys（Standard Plan + 所有item的额外模块）
    const baseModuleKeys = standardPlan.includedModuleKeys as string[];
    const allAdditionalModuleKeys = new Set<string>();

    for (const item of items) {
      for (const moduleKey of item.additionalModules || []) {
        allAdditionalModuleKeys.add(moduleKey);
      }
    }

    const allModuleKeys = [...new Set([...baseModuleKeys, ...allAdditionalModuleKeys])];

    // 3. 获取所有模块信息
    const allModules = await prisma.module.findMany({
      where: {
        key: { in: allModuleKeys },
        status: 'ACTIVE',
      },
    });

    if (allModules.length !== allModuleKeys.length) {
      const foundKeys = allModules.map((m) => m.key);
      const missingKeys = allModuleKeys.filter((k) => !foundKeys.includes(k));

      throw new AppError('INVALID_MODULE_KEYS', 'Some module keys are invalid or inactive', 400, {
        missingKeys,
      });
    }

    const moduleMap = new Map(allModules.map((m) => [m.key, m]));

    // 4. 收集所有需要的资源类型
    const allResourceTypes = new Set<string>();
    for (const item of items) {
      for (const res of item.additionalResources || []) {
        allResourceTypes.add(res.resourceType);
      }
    }

    // 5. 获取所有资源信息
    let allResources: any[] = [];
    if (allResourceTypes.size > 0) {
      allResources = await prisma.resource.findMany({
        where: {
          type: { in: Array.from(allResourceTypes) },
          status: 'ACTIVE',
        },
      });

      if (allResources.length !== allResourceTypes.size) {
        const foundTypes = allResources.map((r) => r.type);
        const missingTypes = Array.from(allResourceTypes).filter((t) => !foundTypes.includes(t));

        throw new AppError('INVALID_RESOURCE_TYPES', 'Some resource types are invalid or inactive', 400, {
          missingTypes,
        });
      }
    }

    const resourceMap = new Map(allResources.map((r) => [r.type, r]));

    // 6. 计算每个item的价格
    const itemsWithPricing = items.map((item) => {
      // 将Decimal转为number进行计算
      let itemTotal = Number(standardPlan.monthlyPrice);

      // 创建一个Set来追踪Standard Plan中已包含的模块
      const includedModuleKeys = new Set(baseModuleKeys);

      // 额外模块费用（过滤掉Standard Plan已包含的模块）
      const additionalModulesBreakdown: Array<{ key: string; name: string; price: number }> = [];
      for (const moduleKey of item.additionalModules || []) {
        // 如果模块已经包含在Standard Plan中,跳过
        if (includedModuleKeys.has(moduleKey)) {
          logger.warn('Duplicate module skipped in price calculation', {
            organizationId: item.organizationId,
            moduleKey,
            reason: 'Already included in Standard Plan',
          });
          continue;
        }

        const module = moduleMap.get(moduleKey);
        if (module) {
          const modulePrice = Number(module.monthlyPrice);
          itemTotal += modulePrice;
          additionalModulesBreakdown.push({
            key: module.key,
            name: module.name,
            price: modulePrice,
          });
        }
      }

      // 额外资源费用
      const additionalResourcesBreakdown: Array<{
        type: string;
        name: string;
        quantity: number;
        unitPrice: number;
        totalPrice: number;
      }> = [];
      for (const res of item.additionalResources || []) {
        const resource = resourceMap.get(res.resourceType);
        if (resource) {
          const unitPrice = Number(resource.monthlyPrice);
          const resourceTotal = unitPrice * res.quantity;
          itemTotal += resourceTotal;
          additionalResourcesBreakdown.push({
            type: resource.type,
            name: resource.name,
            quantity: res.quantity,
            unitPrice: unitPrice,
            totalPrice: resourceTotal,
          });
        }
      }

      return {
        organizationId: item.organizationId,
        standardPlanPrice: Number(standardPlan.monthlyPrice),
        additionalModules: additionalModulesBreakdown,
        additionalResources: additionalResourcesBreakdown,
        monthlyPrice: itemTotal,
      };
    });

    // 7. 总价（所有org的总和）
    const subtotal = itemsWithPricing.reduce((sum, item) => sum + item.monthlyPrice, 0);

    // 8. 优惠券折扣（TODO: 未来实现coupon表和逻辑）
    let discount = 0;
    if (couponCode) {
      // TODO: 查询coupon表并验证有效性
      // const coupon = await prisma.coupon.findUnique({ where: { code: couponCode } });
      // if (coupon && coupon.isActive) {
      //   discount = calculateDiscount(subtotal, coupon);
      // }
      logger.warn('Coupon code provided but coupon feature is not yet implemented', {
        couponCode,
      });
    }

    // 9. 年度折扣（如果billingCycle是yearly）
    let yearlyDiscount = 0;
    let totalBeforeTax = subtotal - discount;
    if (billingCycle === 'yearly') {
      const YEARLY_DISCOUNT_PERCENT = parseInt(process.env.YEARLY_DISCOUNT || '10', 10);
      yearlyDiscount = (subtotal * YEARLY_DISCOUNT_PERCENT) / 100;
      totalBeforeTax = subtotal * 12 - yearlyDiscount - discount;
    }

    // 10. 返回计算结果
    return {
      items: itemsWithPricing,
      summary: {
        standardPlanPrice: Number(standardPlan.monthlyPrice),
        itemCount: items.length,
        billingCycle,
        subtotal,
        discount,
        yearlyDiscount: billingCycle === 'yearly' ? yearlyDiscount : 0,
        totalBeforeTax,
        currency: 'CAD',
        // 注意: 税费由Stripe根据用户地址自动计算,这里不包含
        taxNote: 'Tax will be calculated by payment provider based on billing address',
      },
      message: couponCode
        ? 'Price calculation completed. Note: Coupon feature is not yet implemented.'
        : 'Price calculation completed successfully.',
    };
  }

  // ========================================
  // API 2: 激活订阅 (Trial → Active) - 立即结束Trial并扣款
  // ========================================
  /**
   * 激活Trial订阅，立即结束Trial并转为正式订阅
   *
   * 新逻辑：
   * 1. 订阅必须处于TRIAL状态且已有支付方式
   * 2. 调用Stripe API立即结束Trial并首次扣款
   * 3. 更新订阅状态为ACTIVE，设置renewsAt
   * 4. 不再创建Checkout Session(支付信息已在创建Trial时收集)
   *
   * @param payerId - 付款人ID(来自JWT)
   * @param data - 激活请求数据
   * @param organizations - 用户的组织列表(来自JWT)
   */
  async activateSubscription(payerId: string, data: ActivateSubscriptionRequest, organizations?: Array<any>) {
    const { organizationId } = data;

    // 1. 验证组织归属和类型
    if (!organizations || organizations.length === 0) {
      throw new AppError(
        'ORGANIZATIONS_NOT_FOUND',
        'No organizations found in user context',
        400
      );
    }

    const org = organizations.find((o) => o.id === organizationId);
    if (!org) {
      throw new AppError(
        'ORGANIZATION_NOT_FOUND',
        'Organization not found in user organizations',
        404,
        { organizationId }
      );
    }

    // 2. 查找订阅，必须是TRIAL状态
    const subscription = await prisma.subscription.findUnique({
      where: { orgId: organizationId },
    });

    if (!subscription) {
      throw new AppError(
        'SUBSCRIPTION_NOT_FOUND',
        'No trial subscription found for this organization',
        404
      );
    }

    if (subscription.status !== 'TRIAL') {
      throw new AppError(
        'INVALID_SUBSCRIPTION_STATUS',
        `Cannot activate subscription. Current status: ${subscription.status}. Only TRIAL subscriptions can be activated.`,
        400,
        { currentStatus: subscription.status }
      );
    }

    // 4. 检查订阅是否已被取消
    if (subscription.cancelledAt) {
      throw new AppError(
        'SUBSCRIPTION_CANCELLED',
        'Cannot activate a cancelled trial subscription. Please reactivate the subscription first using the reactivate API, then try activating again.',
        400,
        {
          organizationId,
          subscriptionId: subscription.id,
          cancelledAt: subscription.cancelledAt,
          hint: 'Call POST /subscriptions/reactivate first to clear cancellation, then call POST /subscriptions/activate',
        }
      );
    }

    // 5. 验证是否已有支付方式(Checkout Session已创建)
    if (!subscription.providerCustomerId) {
      throw new AppError(
        'PAYMENT_METHOD_NOT_FOUND',
        'No payment method found for this subscription. Please complete payment setup first.',
        400,
        {
          organizationId,
          subscriptionId: subscription.id,
          hint: 'User needs to complete Stripe Checkout Session created during trial creation',
        }
      );
    }

    const providerMetadata = subscription.providerMetadata as any;

    // 6. 检查是否启用测试模式
    const isTestMode = process.env.ALLOW_TEST_MODE === 'true';

    if (isTestMode) {
      // 测试模式：跳过webhook验证,模拟激活
      logger.warn('⚠️  TEST MODE ENABLED: Skipping Stripe webhook validation and API call', {
        subscriptionId: subscription.id,
        organizationId,
      });

      // 计算下次续费日期
      const now = new Date();
      const billingAnchorDay = now.getDate();
      const renewsAt = this.calculateNextRenewal(billingAnchorDay, now);

      // 模拟Stripe Subscription ID
      const mockStripeSubId = providerMetadata?.stripeSubscriptionId || `sub_test_${subscription.id}`;

      // 直接更新订阅状态
      await prisma.$transaction(async (tx) => {
        await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            status: 'ACTIVE',
            trialEndsAt: now,
            renewsAt,
            providerMetadata: {
              ...providerMetadata,
              stripeSubscriptionId: mockStripeSubId,
              stripeSubscriptionStatus: 'active',
              trialEndedAt: now.toISOString(),
              manualActivation: true,
              testMode: true, // 标记为测试模式激活
            },
            updatedAt: now,
          },
        });

        // 创建激活日志
        await tx.subscriptionLog.create({
          data: {
            subscriptionId: subscription.id,
            action: 'TRIAL_ENDED_MANUALLY',
            actorId: payerId,
            details: {
              stripeSubscriptionId: mockStripeSubId,
              stripeSubscriptionStatus: 'active',
              previousStatus: 'TRIAL',
              newStatus: 'ACTIVE',
              renewsAt,
              manualActivation: true,
              testMode: true,
              warning: 'Activated in TEST MODE - no actual Stripe charge',
            },
          },
        });
      });

      return {
        subscriptionId: subscription.id,
        organizationId: subscription.orgId,
        status: 'ACTIVE',
        activatedAt: now,
        renewsAt,
        stripeSubscriptionId: mockStripeSubId,
        message: '⚠️  TEST MODE: Trial ended successfully (no actual charge). Set ALLOW_TEST_MODE=false in production.',
      };
    }

    // 生产模式：严格验证
    if (!providerMetadata?.checkoutSessionId || providerMetadata?.checkoutSessionStatus !== 'complete') {
      throw new AppError(
        'PAYMENT_SETUP_INCOMPLETE',
        'Payment setup is not complete. Please complete Stripe checkout first.',
        400,
        {
          checkoutSessionStatus: providerMetadata?.checkoutSessionStatus || 'unknown',
          hint: 'User needs to complete Stripe Checkout Session',
        }
      );
    }

    // 7. 查找Stripe Subscription ID (应该在webhook中已保存)
    const stripeSubscriptionId = providerMetadata?.stripeSubscriptionId;
    if (!stripeSubscriptionId) {
      throw new AppError(
        'STRIPE_SUBSCRIPTION_NOT_FOUND',
        'Stripe subscription not found. Payment setup may be incomplete.',
        404,
        {
          organizationId,
          subscriptionId: subscription.id,
          hint: 'Stripe subscription should be created when checkout.session.completed webhook is received',
        }
      );
    }

    // 8. 调用Stripe API立即结束Trial
    try {
      const stripeSubscription = await stripe.subscriptions.update(stripeSubscriptionId, {
        trial_end: 'now', // 立即结束Trial并扣款
        metadata: {
          activatedBy: payerId,
          activatedAt: new Date().toISOString(),
          manualActivation: 'true',
        },
      });

      logger.info('Stripe trial ended successfully', {
        stripeSubscriptionId,
        subscriptionId: subscription.id,
        status: stripeSubscription.status,
      });

      // 9. 计算下次续费日期 (使用Billing Anchor Day)
      const now = new Date();
      const billingAnchorDay = now.getDate();
      const renewsAt = this.calculateNextRenewal(billingAnchorDay, now);

      // 9. 更新订阅记录
      await prisma.$transaction(async (tx) => {
        await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            status: 'ACTIVE',
            trialEndsAt: now, // 更新Trial结束时间为现在
            renewsAt, // 设置下次续费日期
            providerMetadata: {
              ...providerMetadata,
              stripeSubscriptionId,
              stripeSubscriptionStatus: stripeSubscription.status,
              trialEndedAt: now.toISOString(),
              manualActivation: true,
            },
            updatedAt: now,
          },
        });

        // 创建激活日志
        await tx.subscriptionLog.create({
          data: {
            subscriptionId: subscription.id,
            action: 'TRIAL_ENDED_MANUALLY',
            actorId: payerId,
            details: {
              stripeSubscriptionId,
              stripeSubscriptionStatus: stripeSubscription.status,
              previousStatus: 'TRIAL',
              newStatus: 'ACTIVE',
              renewsAt,
              manualActivation: true,
            },
          },
        });
      });

      // 10. 返回激活成功信息
      return {
        subscriptionId: subscription.id,
        organizationId: subscription.orgId,
        status: 'ACTIVE',
        activatedAt: now,
        renewsAt,
        stripeSubscriptionId,
        message: 'Trial ended successfully. Your subscription is now active and you have been charged.',
      };
    } catch (error: any) {
      logger.error('Failed to end Stripe trial', {
        error: error.message,
        stripeSubscriptionId,
        subscriptionId: subscription.id,
      });

      throw new AppError(
        'STRIPE_API_ERROR',
        `Failed to activate subscription: ${error.message}`,
        500,
        {
          stripeError: error.message,
          stripeSubscriptionId,
        }
      );
    }
  }

  /**
   * 生成发票号 (用于事务内部调用)
   * 格式：INV-2025-01-001
   */
  private async generateInvoiceNumber(tx: any): Promise<string> {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');

    const startOfMonth = new Date(year, now.getMonth(), 1);
    const endOfMonth = new Date(year, now.getMonth() + 1, 0, 23, 59, 59);

    const count = await tx.invoice.count({
      where: {
        createdAt: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
    });

    const sequence = String(count + 1).padStart(3, '0');
    return `INV-${year}-${month}-${sequence}`;
  }

  // ========================================
  // API 8: 取消订阅
  // ========================================
  async cancelSubscription(orgId: string, payerId: string, data: CancelSubscriptionRequest) {
    const { reason, otherReason } = data;

    // 1. 查找订阅
    const subscription = await prisma.subscription.findUnique({
      where: { orgId },
    });

    if (!subscription) {
      throw new AppError('SUBSCRIPTION_NOT_FOUND', 'Subscription not found', 404);
    }

    // 2. 验证订阅状态
    if (subscription.status === 'CANCELLED' || subscription.cancelledAt) {
      throw new AppError(
        'ALREADY_CANCELLED',
        'Subscription is already cancelled',
        400
      );
    }

    // 3. 获取取消原因显示文本
    const cancelReasonDisplay = CancelReasonDisplay[reason as CancelReason];

    // 4. 更新订阅为已取消（但status保持ACTIVE/TRIAL到月底/试用期结束）
    const now = new Date();
    // 对于TRIAL订阅使用trialEndsAt，对于ACTIVE订阅使用renewsAt
    const accessUntil =
      subscription.status === 'TRIAL' ? subscription.trialEndsAt! : subscription.renewsAt!;
    const remainingDays = this.daysBetween(now, accessUntil);

    const result = await prisma.$transaction(async (tx) => {
      const updatedSubscription = await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          cancelledAt: now,
          // 如果是OTHER,存储用户输入的详细原因;否则存储枚举值
          cancelReason: reason === 'OTHER' ? otherReason : reason,
          // status保持ACTIVE，等到renewsAt时由Webhook更新为CANCELLED
          updatedAt: now,
        },
      });

      // 调用Stripe设置在计费周期结束时取消（不是月底，是renewsAt日期）
      if (subscription.providerCustomerId && subscription.providerMetadata) {
        const stripeSubscriptionId = (subscription.providerMetadata as any).stripeSubscriptionId;
        if (stripeSubscriptionId) {
          try {
            // cancel_at_period_end = true：在当前计费周期结束时取消
            await stripeService.cancelSubscription(stripeSubscriptionId, true);
            logger.info('Stripe订阅已标记为计费周期结束时取消', {
              stripeSubscriptionId,
              effectiveDate: accessUntil,
              organizationId: orgId,
            });
          } catch (error) {
            logger.error('Stripe取消订阅失败', {
              error: error instanceof Error ? error.message : String(error),
              stripeSubscriptionId,
              organizationId: orgId,
            });
            // 不抛出错误，允许数据库操作继续（用户意图已记录）
          }
        }
      }

      // 创建日志
      await tx.subscriptionLog.create({
        data: {
          subscriptionId: subscription.id,
          action: 'SUBSCRIPTION_CANCELLED',
          actorId: payerId,
          details: {
            reason,
            reasonDisplay: cancelReasonDisplay,
            otherReason,
            cancelledAt: now,
            effectiveDate: accessUntil,
            remainingDays,
          },
        },
      });

      return updatedSubscription;
    });

    return {
      subscription: {
        id: result.id,
        status: result.status,
        cancelledAt: result.cancelledAt,
        // 从数据库读取cancelReason(可能是枚举值或用户输入的详细原因)
        cancelReason: result.cancelReason,
        cancelReasonDisplay,
        // 向后兼容：当是OTHER时，otherReason返回详细原因；否则返回null
        otherReason: reason === 'OTHER' ? result.cancelReason : null,
        effectiveDate: accessUntil,
        renewsAt: result.renewsAt,
      },
      accessInfo: {
        remainingDays,
        accessUntil,
        fullAccessMessage: `You will have full access to all features until ${accessUntil.toLocaleDateString()}`,
      },
      refundInfo: {
        refundAmount: 0,
        refundMessage:
          'No refund. Subscription will remain active until the end of current billing period.',
      },
    };
  }

  // ========================================
  // API 9: 重新激活订阅
  // ========================================
  async reactivateSubscription(orgId: string, payerId: string) {
    // 1. 查找订阅
    const subscription = await prisma.subscription.findUnique({
      where: { orgId },
      include: {
        subscriptionModules: {
          include: { module: true },
          where: { isActive: true },
        },
        subscriptionResources: {
          include: { resource: true },
        },
      },
    });

    if (!subscription) {
      throw new AppError('SUBSCRIPTION_NOT_FOUND', 'Subscription not found', 404);
    }

    // 2. 验证订阅已取消
    if (!subscription.cancelledAt) {
      throw new AppError('NOT_CANCELLED', 'Subscription is not cancelled', 400);
    }

    // 3. 验证必须在原订阅周期内（renewsAt未过期）
    const now = new Date();
    if (now >= subscription.renewsAt) {
      throw new AppError(
        'SUBSCRIPTION_PERIOD_ENDED',
        'Cannot reactivate subscription. The original subscription period has ended. Please create a new subscription.',
        400,
        {
          renewsAt: subscription.renewsAt,
          currentTime: now,
        }
      );
    }

    // 4. 验证状态必须是ACTIVE或TRIAL（已取消但未到期）
    if (subscription.status !== 'ACTIVE' && subscription.status !== 'TRIAL') {
      throw new AppError(
        'INVALID_STATUS_FOR_REACTIVATION',
        `Cannot reactivate subscription with status ${subscription.status}. Only cancelled subscriptions (ACTIVE or TRIAL) within their billing period can be reactivated.`,
        400,
        { currentStatus: subscription.status }
      );
    }

    // 5. 重新激活订阅
    const result = await prisma.$transaction(async (tx) => {
      const updatedSubscription = await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          cancelledAt: null,
          cancelReason: null,
          autoRenew: true,
          updatedAt: now,
        },
      });

      // 调用Stripe重新激活订阅
      if (subscription.providerMetadata) {
        const stripeSubscriptionId = (subscription.providerMetadata as any).stripeSubscriptionId;
        if (stripeSubscriptionId) {
          try {
            // 取消"计费周期结束时取消"的设置，订阅将继续自动续费
            await stripe.subscriptions.update(stripeSubscriptionId, {
              cancel_at_period_end: false,
            });
            logger.info('Stripe订阅已重新激活', {
              stripeSubscriptionId,
              organizationId: subscription.orgId,
            });
          } catch (error) {
            logger.error('Stripe重新激活失败', {
              error: error instanceof Error ? error.message : String(error),
              stripeSubscriptionId,
              organizationId: subscription.orgId,
            });
            // 不抛出错误，允许数据库操作继续
          }
        }
      }

      // 创建日志
      await tx.subscriptionLog.create({
        data: {
          subscriptionId: subscription.id,
          action: 'SUBSCRIPTION_REACTIVATED',
          actorId: payerId,
          details: {
            reactivatedAt: now,
            previousCancelReason: subscription.cancelReason,
          },
        },
      });

      return updatedSubscription;
    });

    // 4. 构建恢复配置信息
    const modules = subscription.subscriptionModules.map((sm) => ({
      key: sm.module.key,
      name: sm.module.name,
    }));

    const resources: Record<string, number> = {};
    subscription.subscriptionResources.forEach((sr) => {
      resources[sr.resource.type] = sr.quantity;
    });

    // 计算月费
    let monthlyPrice = subscription.standardPrice.toNumber();
    let moduleBreakdown: Record<string, number> = {};
    let resourceBreakdown: Record<string, number> = {};

    subscription.subscriptionModules.forEach((sm) => {
      monthlyPrice += sm.module.monthlyPrice.toNumber();
      moduleBreakdown[sm.module.key] = sm.module.monthlyPrice.toNumber();
    });

    subscription.subscriptionResources.forEach((sr) => {
      const resourceTotal = sr.resource.monthlyPrice.toNumber() * sr.quantity;
      monthlyPrice += resourceTotal;
      resourceBreakdown[sr.resource.type] = resourceTotal;
    });

    return {
      subscription: {
        id: result.id,
        status: result.status,
        cancelledAt: result.cancelledAt,
        cancelReason: result.cancelReason,
        renewsAt: result.renewsAt,
        autoRenew: result.autoRenew,
      },
      restoredConfiguration: {
        modules,
        resources,
        monthlyPrice,
        breakdown: {
          standardPlan: subscription.standardPrice.toNumber(),
          modules: moduleBreakdown,
          resources: resourceBreakdown,
        },
      },
    };
  }

  // ========================================
  // API 10: 更新支付方式
  // ========================================
  async updatePaymentMethod(payerId: string) {
    // 1. 查找用户的任意一个订阅（获取共享的customerId）
    const subscription = await prisma.subscription.findFirst({
      where: { 
        payerId: payerId,
        providerCustomerId: { not: null }
      },
    });

    if (!subscription) {
      throw new AppError('NO_SUBSCRIPTION', 'No subscription found for this user', 404);
    }

    // 2. 验证订阅状态（Trial订阅无支付方式）
    if (subscription.status === 'TRIAL') {
      throw new AppError(
        'TRIAL_NO_PAYMENT',
        'Trial subscriptions cannot access billing portal. Please activate subscription first.',
        403
      );
    }

    // 3. 验证是否已激活（必须有Stripe Customer ID）
    if (!subscription.providerCustomerId) {
      throw new AppError(
        'NO_CUSTOMER_ID',
        'Subscription has not been activated. No Stripe customer ID found.',
        400
      );
    }

    // 4. 获取returnUrl（使用环境变量，和/subscribe一样）
    const DEFAULT_RETURN_URL = process.env.STRIPE_SUCCESS_URL || 'https://tymoe.com/settings/billing';

    // 5. 创建Stripe Billing Portal Session
    const portalSession = await stripeService.createBillingPortalSession({
      customerId: subscription.providerCustomerId,
      returnUrl: DEFAULT_RETURN_URL,
    });

    // 6. 记录日志
    await prisma.subscriptionLog.create({
      data: {
        subscriptionId: subscription.id,
        action: 'BILLING_PORTAL_ACCESSED',
        actorId: payerId,
        details: {
          portalSessionId: portalSession.id,
          portalUrl: portalSession.url,
          returnUrl: DEFAULT_RETURN_URL,
          appliesTo: 'all_user_subscriptions', // 标记：应用到所有订阅
        },
      },
    });

    // 7. 返回Portal URL供前端跳转
    return {
      portalUrl: portalSession.url,
      expiresAt: new Date(portalSession.created * 1000 + 3600000), // 1小时后过期
      returnUrl: DEFAULT_RETURN_URL,
    };
  }

  // ========================================
  // API 11: 更新短信/邮件预算和通知设置
  // ========================================
  async updateSmsBudget(orgId: string, payerId: string, data: UpdateSmsBudgetRequest) {
    const { monthlyBudget: smsMonthlyBudget, alerts: smsBudgetAlerts, notifyByEmail: smsNotifyByEmail, notifyBySms: smsNotifyBySms } = data;

    // 1. 查找订阅
    const subscription = await prisma.subscription.findUnique({
      where: { orgId },
    });

    if (!subscription) {
      throw new AppError('SUBSCRIPTION_NOT_FOUND', 'Subscription not found', 404);
    }

    // 2. 检查是否订阅了SMS或Email模块
    const hasSmsModule = await this.hasModuleEnabled(orgId, 'sms');
    const hasEmailModule = await this.hasModuleEnabled(orgId, 'email');

    if (!hasSmsModule && !hasEmailModule) {
      throw new AppError(
        'MODULE_NOT_ENABLED',
        'SMS or Email module must be enabled to configure notification settings',
        403
      );
    }

    // 3. 验证预算金额
    if (smsMonthlyBudget !== null && smsMonthlyBudget <= 0) {
      throw new AppError(
        'INVALID_BUDGET',
        'SMS budget must be greater than 0 or null for unlimited',
        400
      );
    }

    // 3. 验证阈值
    if (smsBudgetAlerts) {
      for (const threshold of smsBudgetAlerts) {
        if (threshold < 0 || threshold > 100) {
          throw new AppError(
            'INVALID_THRESHOLD',
            'Alert thresholds must be between 0 and 100',
            400
          );
        }
      }
    }

    // 4. 更新订阅
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const updatedSubscription = await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          smsMonthlyBudget,
          smsBudgetAlerts: smsBudgetAlerts || [],
          smsNotifyByEmail: smsNotifyByEmail ?? subscription.smsNotifyByEmail,
          smsNotifyBySms: smsNotifyBySms ?? subscription.smsNotifyBySms,
          updatedAt: now,
        },
      });

      // 创建日志
      await tx.subscriptionLog.create({
        data: {
          subscriptionId: subscription.id,
          action: 'SMS_BUDGET_UPDATED',
          actorId: payerId,
          details: {
            monthlyBudget: smsMonthlyBudget,
            alerts: smsBudgetAlerts,
            notifyByEmail: smsNotifyByEmail,
            notifyBySms: smsNotifyBySms,
            updatedAt: now,
          },
        },
      });

      return updatedSubscription;
    });

    // 5. 计算当前使用率
    // smsCurrentSpending可能是null（新创建的订阅或未使用过SMS），需要处理
    const currentSpending = result.smsCurrentSpending ? result.smsCurrentSpending.toNumber() : 0;
    const usagePercentage =
      smsMonthlyBudget && smsMonthlyBudget > 0
        ? parseFloat(((currentSpending / smsMonthlyBudget) * 100).toFixed(2))
        : 0;

    const remainingBudget =
      smsMonthlyBudget && smsMonthlyBudget > 0 ? smsMonthlyBudget - currentSpending : null;

    // 6. 格式化告警信息
    const alerts = (smsBudgetAlerts || []).map((alert: any) => ({
      threshold: alert.threshold,
      triggered: alert.triggered || false,
      amount: smsMonthlyBudget ? (smsMonthlyBudget * alert.threshold) / 100 : null,
    }));

    return {
      smsBudget: {
        monthlyBudget: smsMonthlyBudget,
        currentSpending,
        remainingBudget,
        usagePercentage,
        alerts,
      },
      notifications: {
        notifyByEmail: result.smsNotifyByEmail,
        notifyBySms: result.smsNotifyBySms,
        email: null, // TODO: 从用户信息获取
        phone: null, // TODO: 从用户信息获取
      },
      renewalInfo: {
        nextResetDate: subscription.renewsAt,
        description: 'Budget and spending will reset on next renewal',
      },
    };
  }

  // ========================================
  // API 7: 添加模块到订阅
  // ========================================
  async addModuleToSubscription(orgId: string, payerId: string, data: { moduleKey: string }) {
    const { moduleKey } = data;

    // 1. 查找订阅
    const subscription = await prisma.subscription.findUnique({
      where: { orgId },
      include: {
        subscriptionModules: {
          include: {
            module: true
          }
        }
      }
    });

    if (!subscription) {
      throw new AppError('SUBSCRIPTION_NOT_FOUND', 'Subscription not found', 404);
    }

    // 2. 检查订阅状态
    if (subscription.status !== 'ACTIVE' && subscription.status !== 'TRIAL') {
      throw new AppError(
        'SUBSCRIPTION_INVALID_STATUS',
        'Can only add modules to ACTIVE or TRIAL subscriptions',
        400
      );
    }

    // 2.5. 检查订阅是否已取消
    if (subscription.cancelledAt) {
      throw new AppError(
        'SUBSCRIPTION_CANCELLED',
        'Cannot add modules to a cancelled subscription',
        400
      );
    }

    // 3. 查找模块
    const module = await prisma.module.findUnique({
      where: { key: moduleKey }
    });

    if (!module) {
      throw new AppError('MODULE_NOT_FOUND', `Module '${moduleKey}' not found`, 404);
    }

    if (module.status !== 'ACTIVE') {
      throw new AppError('MODULE_NOT_AVAILABLE', `Module '${moduleKey}' is not available`, 400);
    }

    // 4. 检查模块是否已添加
    const existingModule = subscription.subscriptionModules.find(
      sm => sm.module.key === moduleKey && sm.isActive && !sm.removedAt
    );

    if (existingModule) {
      throw new AppError('MODULE_ALREADY_ADDED', `Module '${moduleKey}' is already added`, 409);
    }

    // 5. 计算按比例费用
    const now = new Date();
    const renewsAt = subscription.renewsAt!;
    const remainingDays = this.daysBetween(now, renewsAt);
    const monthlyPrice = module.monthlyPrice.toNumber();
    const dailyRate = monthlyPrice / 30;
    const proratedCharge = parseFloat((dailyRate * remainingDays).toFixed(2));

    // 6. 使用事务添加模块
    const result = await prisma.$transaction(async (tx) => {
      // 6.1 创建模块关联
      const subscriptionModule = await tx.subscriptionModule.create({
        data: {
          subscriptionId: subscription.id,
          moduleId: module.id,
          isActive: true,
          addedAt: now,
        },
        include: {
          module: true
        }
      });

      // 6.2 记录按比例费用到 usage 表
      await tx.usage.create({
        data: {
          subscriptionId: subscription.id,
          moduleId: module.id,
          usageType: 'module_prorated',
          quantity: 1,
          unitPrice: proratedCharge,
          amount: proratedCharge,
          isFree: false,
          metadata: {
            moduleKey,
            moduleName: module.name,
            monthlyPrice,
            remainingDays,
            addedAt: now.toISOString(),
          },
        },
      });

      // 6.3 创建日志
      await tx.subscriptionLog.create({
        data: {
          subscriptionId: subscription.id,
          action: 'MODULE_ADDED',
          actorId: payerId,
          details: {
            moduleKey,
            moduleName: module.name,
            monthlyPrice,
            proratedCharge,
            remainingDays,
            addedAt: now.toISOString(),
          },
        },
      });

      return subscriptionModule;
    });

    // 7. 返回结果
    return {
      module: {
        key: result.module.key,
        name: result.module.name,
        description: result.module.description,
        monthlyPrice: result.module.monthlyPrice.toNumber(),
        addedAt: result.addedAt,
      },
      billing: {
        proratedCharge,
        remainingDays,
        nextBillingDate: renewsAt,
        note: `Prorated charge for ${remainingDays} days until next billing cycle`,
      },
    };
  }

  // ========================================
  // API 8: 添加资源到订阅
  // ========================================
  async addResourceToSubscription(
    orgId: string,
    payerId: string,
    data: { resourceKey: string; quantity: number }
  ) {
    const { resourceKey, quantity } = data;

    // 1. 查找订阅
    const subscription = await prisma.subscription.findUnique({
      where: { orgId },
      include: {
        subscriptionResources: {
          include: {
            resource: true
          }
        }
      }
    });

    if (!subscription) {
      throw new AppError('SUBSCRIPTION_NOT_FOUND', 'Subscription not found', 404);
    }

    // 2. 检查订阅状态
    if (subscription.status !== 'ACTIVE' && subscription.status !== 'TRIAL') {
      throw new AppError(
        'SUBSCRIPTION_INVALID_STATUS',
        'Can only add resources to ACTIVE or TRIAL subscriptions',
        400
      );
    }

    // 2.5. 检查订阅是否已取消
    if (subscription.cancelledAt) {
      throw new AppError(
        'SUBSCRIPTION_CANCELLED',
        'Cannot add resources to a cancelled subscription',
        400
      );
    }

    // 3. 查找资源
    const resource = await prisma.resource.findUnique({
      where: { type: resourceKey }
    });

    if (!resource) {
      throw new AppError('RESOURCE_NOT_FOUND', `Resource '${resourceKey}' not found`, 404);
    }

    if (resource.status !== 'ACTIVE') {
      throw new AppError('RESOURCE_NOT_AVAILABLE', `Resource '${resourceKey}' is not available`, 400);
    }

    // 4. 检查资源是否已添加（如果已存在，则增加数量）
    const existingResource = subscription.subscriptionResources.find(
      sr => sr.resource.type === resourceKey && !sr.removedAt
    );

    // 5. 计算按比例费用
    const now = new Date();
    const renewsAt = subscription.renewsAt!;
    const remainingDays = this.daysBetween(now, renewsAt);
    const monthlyPrice = resource.monthlyPrice.toNumber();
    const dailyRate = monthlyPrice / 30;
    const proratedChargePerUnit = parseFloat((dailyRate * remainingDays).toFixed(2));
    const totalProratedCharge = parseFloat((proratedChargePerUnit * quantity).toFixed(2));

    // 6. 使用事务添加/更新资源
    const result = await prisma.$transaction(async (tx) => {
      let subscriptionResource;

      if (existingResource) {
        // 如果资源已存在，增加数量
        const newQuantity = existingResource.quantity + quantity;
        subscriptionResource = await tx.subscriptionResource.update({
          where: { id: existingResource.id },
          data: {
            quantity: newQuantity,
          },
          include: {
            resource: true
          }
        });
      } else {
        // 如果资源不存在，创建新记录
        subscriptionResource = await tx.subscriptionResource.create({
          data: {
            subscriptionId: subscription.id,
            resourceId: resource.id,
            quantity,
            addedAt: now,
          },
          include: {
            resource: true
          }
        });
      }

      // 6.2 记录按比例费用到 usage 表
      await tx.usage.create({
        data: {
          subscriptionId: subscription.id,
          moduleId: null, // 资源不关联 module
          usageType: 'resource_prorated',
          quantity,
          unitPrice: proratedChargePerUnit,
          amount: totalProratedCharge,
          isFree: false,
          metadata: {
            resourceType: resourceKey,
            resourceName: resource.name,
            resourceCategory: resource.category,
            monthlyPrice,
            remainingDays,
            addedAt: now.toISOString(),
            action: existingResource ? 'quantity_increased' : 'resource_added',
          },
        },
      });

      // 6.3 创建日志
      await tx.subscriptionLog.create({
        data: {
          subscriptionId: subscription.id,
          action: existingResource ? 'RESOURCE_QUANTITY_INCREASED' : 'RESOURCE_ADDED',
          actorId: payerId,
          details: {
            resourceType: resourceKey,
            resourceName: resource.name,
            resourceCategory: resource.category,
            quantity,
            monthlyPrice,
            proratedChargePerUnit,
            totalProratedCharge,
            remainingDays,
            addedAt: now.toISOString(),
            ...(existingResource && { previousQuantity: existingResource.quantity }),
          },
        },
      });

      return subscriptionResource;
    });

    // 7. 返回结果
    return {
      resource: {
        type: result.resource.type,
        name: result.resource.name,
        category: result.resource.category,
        unitPrice: result.resource.monthlyPrice.toNumber(),
        quantity: result.quantity,
        addedAt: result.addedAt,
      },
      billing: {
        proratedChargePerUnit,
        totalProratedCharge,
        quantity,
        remainingDays,
        nextBillingDate: renewsAt,
        note: `Prorated charge for ${quantity} unit(s) × ${remainingDays} days until next billing cycle`,
      },
    };
  }
}

export const subscriptionService = new SubscriptionService();