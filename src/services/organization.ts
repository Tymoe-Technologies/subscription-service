import { prisma } from '../infra/prisma.js';
import { stripeService } from '../infra/stripe.js';
import { cacheService } from '../infra/redis.js';
import { logger } from '../utils/logger.js';
import { SUBSCRIPTION_STATUS } from '../constants';
import type { Organization } from '@prisma/client';

export interface CreateOrganizationParams {
  id: string; // 来自auth-service的organizationId
  userId: string; // 创建组织的用户ID
  name: string;
  email?: string; // 可选，用于创建Stripe客户
}

export interface OrganizationWithSubscriptions extends Organization {
  subscriptions: Array<{
    id: string;
    productKey: string;
    tier: string | null;
    status: string;
    billingCycle: string | null;
    currentPeriodEnd: Date | null;
    trialEnd: Date | null;
  }>;
}

export class OrganizationService {
  // 创建组织
  async createOrganization(params: CreateOrganizationParams): Promise<Organization> {
    // 检查组织是否已存在
    const existing = await prisma.organization.findUnique({
      where: { id: params.id },
    });

    if (existing) {
      throw new Error(`Organization ${params.id} already exists`);
    }

    // 创建Stripe客户
    const stripeCustomer = await stripeService.createCustomer({
      ...(params.email && { email: params.email }),
      name: params.name,
      organizationId: params.id,
    });

    // 创建组织记录
    const organization = await prisma.organization.create({
      data: {
        id: params.id,
        userId: params.userId,
        name: params.name,
        stripeCustomerId: stripeCustomer.id,
      },
    });

    // 清除缓存
    await this.clearOrganizationCache(params.id);

    return organization;
  }

  // 获取组织信息（排除已删除的）
  async getOrganization(id: string): Promise<Organization | null> {
    // 先检查缓存
    const cacheKey = `org:${id}`;
    const cached = await cacheService.get<Organization>(cacheKey);
    if (cached) {
      // 检查是否已被软删除
      if (cached.deletedAt) {
        return null;
      }
      return cached;
    }

    // 从数据库获取（排除已删除的）
    const organization = await prisma.organization.findUnique({
      where: {
        id,
        deletedAt: null, // 只获取未删除的
      },
    });

    if (organization) {
      // 缓存30分钟
      await cacheService.set(cacheKey, organization, 1800);
    }

    return organization;
  }

  // 获取组织及其订阅信息
  async getOrganizationWithSubscriptions(
    id: string
  ): Promise<OrganizationWithSubscriptions | null> {
    const cacheKey = `org_subs:${id}`;
    const cached = await cacheService.get<OrganizationWithSubscriptions>(cacheKey);
    if (cached) {
      return cached;
    }

    const organization = await prisma.organization.findUnique({
      where: {
        id,
        deletedAt: null, // 排除已删除的
      },
      include: {
        subscriptions: {
          where: {
            deletedAt: null, // 排除已删除的订阅
          },
          select: {
            id: true,
            productKey: true,
            tier: true,
            status: true,
            billingCycle: true,
            currentPeriodEnd: true,
            trialEnd: true,
          },
        },
      },
    });

    if (organization) {
      // 缓存10分钟
      await cacheService.set(cacheKey, organization, 600);
    }

    return organization;
  }

  // 更新组织信息
  async updateOrganization(
    id: string,
    data: Partial<Pick<Organization, 'name'>>
  ): Promise<Organization> {
    const organization = await prisma.organization.update({
      where: {
        id,
        deletedAt: null, // 只更新未删除的
      },
      data,
    });

    // 如果有Stripe客户ID，同步更新Stripe客户信息
    if (organization.stripeCustomerId && data.name) {
      try {
        await stripeService.updateCustomer(organization.stripeCustomerId, {
          name: data.name,
        });
      } catch (error) {
        logger.error('Failed to update Stripe customer information:', error);
        // 不抛出错误，继续执行
      }
    }

    // 清除缓存
    await this.clearOrganizationCache(id);

    return organization;
  }

  // 标记组织已使用试用
  async markTrialUsed(id: string): Promise<void> {
    await prisma.organization.update({
      where: { id },
      data: { hasUsedTrial: true },
    });

    // 清除缓存
    await this.clearOrganizationCache(id);
  }

  // 检查组织是否已使用试用
  async hasUsedTrial(id: string): Promise<boolean> {
    const organization = await this.getOrganization(id);
    return organization?.hasUsedTrial ?? false;
  }

  // 获取组织的Stripe客户ID
  async getStripeCustomerId(id: string): Promise<string | null> {
    const organization = await this.getOrganization(id);
    return organization?.stripeCustomerId ?? null;
  }

  // 设置组织的Stripe客户ID
  async setStripeCustomerId(id: string, stripeCustomerId: string): Promise<void> {
    await prisma.organization.update({
      where: { id },
      data: { stripeCustomerId },
    });

    // 清除缓存
    await this.clearOrganizationCache(id);
  }

  // 软删除组织（保留数据用于审计）
  async deleteOrganization(id: string): Promise<void> {
    // 首先检查组织是否存在且未被删除
    const organization = await prisma.organization.findUnique({
      where: { id, deletedAt: null },
    });

    if (!organization) {
      throw new Error('Organization does not exist or has been deleted');
    }

    // 取消所有活跃订阅
    const activeSubscriptions = await prisma.subscription.findMany({
      where: {
        organizationId: id,
        status: { in: [SUBSCRIPTION_STATUS.ACTIVE, SUBSCRIPTION_STATUS.TRIALING] },
        deletedAt: null,
      },
    });

    for (const subscription of activeSubscriptions) {
      if (subscription.stripeSubscriptionId) {
        try {
          await stripeService.cancelSubscription(subscription.stripeSubscriptionId, false);
        } catch (error) {
          logger.error(`取消Stripe订阅失败 ${subscription.stripeSubscriptionId}:`, error);
        }
      }

      // 软删除订阅
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: SUBSCRIPTION_STATUS.CANCELED,
          deletedAt: new Date(),
        },
      });
    }

    // 软删除组织（设置deletedAt时间戳）
    await prisma.organization.update({
      where: { id },
      data: {
        deletedAt: new Date(),
      },
    });

    logger.info(`Organization ${id} has been soft deleted`, {
      organizationId: id,
      canceledSubscriptions: activeSubscriptions.length,
    });

    // 清除缓存
    await this.clearOrganizationCache(id);
  }

  // 清除组织相关缓存
  private async clearOrganizationCache(id: string): Promise<void> {
    await Promise.all([cacheService.delete(`org:${id}`), cacheService.delete(`org_subs:${id}`)]);
  }

  // 检查组织是否存在
  async organizationExists(id: string): Promise<boolean> {
    const organization = await this.getOrganization(id);
    return !!organization;
  }

  // 获取组织列表（用于管理）
  async listOrganizations(
    page: number = 1,
    limit: number = 20
  ): Promise<{ organizations: Organization[]; total: number; pages: number }> {
    const offset = (page - 1) * limit;

    const [organizations, total] = await Promise.all([
      prisma.organization.findMany({
        skip: offset,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.organization.count(),
    ]);

    const pages = Math.ceil(total / limit);

    return { organizations, total, pages };
  }
}

export const organizationService = new OrganizationService();
