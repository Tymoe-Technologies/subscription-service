import { Request, Response } from 'express';
import { organizationService } from '../services/organization.js';
import { subscriptionService } from '../services/subscription.js';
import { logger } from '../utils/logger.js';
import { getTierFeatures } from '../config/features.js';

// 创建组织
export async function createOrganization(req: Request, res: Response): Promise<void> {
  try {
    const { id, userId, name, email } = req.body;

    if (!id || !userId || !name) {
      res.status(400).json({
        error: 'bad_request',
        message: 'id, userId and name are required',
      });
      return;
    }

    const organization = await organizationService.createOrganization({
      id,
      userId,
      name,
      email,
    });

    res.status(201).json({
      success: true,
      data: { organization },
    });
  } catch (error: unknown) {
    logger.error('Failed to create organization:', error);

    if (error instanceof Error ? error.message : String(error).includes('已存在')) {
      res.status(409).json({
        error: 'conflict',
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    res.status(500).json({
      error: 'server_error',
      message: 'Failed to create organization',
    });
  }
}

// 获取组织信息
export async function getOrganization(req: Request, res: Response): Promise<void> {
  try {
    const { organizationId } = req.params;

    if (!organizationId) {
      res.status(400).json({
        error: 'bad_request',
        message: 'organizationId is required',
      });
      return;
    }

    const organization = await organizationService.getOrganization(organizationId);

    if (!organization) {
      res.status(404).json({
        error: 'not_found',
        message: 'Organization not found',
      });
      return;
    }

    res.json({
      success: true,
      data: { organization },
    });
  } catch (error: unknown) {
    logger.error('Failed to get organization:', error);
    res.status(500).json({
      error: 'server_error',
      message: 'Failed to get organization',
    });
  }
}

// 获取组织及其订阅信息
export async function getOrganizationWithSubscriptions(req: Request, res: Response): Promise<void> {
  try {
    const { organizationId } = req.params;

    if (!organizationId) {
      res.status(400).json({
        error: 'bad_request',
        message: 'organizationId is required',
      });
      return;
    }

    const organization = await organizationService.getOrganizationWithSubscriptions(organizationId);

    if (!organization) {
      res.status(404).json({
        error: 'not_found',
        message: 'Organization not found',
      });
      return;
    }

    // 为每个订阅添加功能列表
    const enrichedOrganization = {
      ...organization,
      subscriptions: organization.subscriptions.map(subscription => ({
        ...subscription,
        features: getTierFeatures(subscription.productKey, subscription.tier || 'basic'),
        isActive: ['active', 'trialing'].includes(subscription.status),
      })),
    };

    res.json({
      success: true,
      data: { organization: enrichedOrganization },
    });
  } catch (error: unknown) {
    logger.error('Failed to get organization subscriptions:', error);
    res.status(500).json({
      error: 'server_error',
      message: 'Failed to get organization subscriptions',
    });
  }
}

// 获取组织缓存信息（专为前端缓存设计）
export async function getOrganizationCacheInfo(req: Request, res: Response): Promise<void> {
  try {
    const { organizationId } = req.params;

    if (!organizationId) {
      res.status(400).json({
        error: 'bad_request',
        message: 'organizationId is required',
      });
      return;
    }

    const organization = await organizationService.getOrganizationWithSubscriptions(organizationId);

    if (!organization) {
      res.status(404).json({
        error: 'not_found',
        message: 'Organization not found',
      });
      return;
    }

    // 构建前端缓存友好的数据格式
    const subscriptions: Record<string, {
      tier: string | null;
      status: string;
      expiresAt: Date | null;
      isActive: boolean;
      billingCycle: string | null;
      features: string[];
    }> = {};

    for (const subscription of organization.subscriptions) {
      subscriptions[subscription.productKey] = {
        tier: subscription.tier,
        status: subscription.status,
        expiresAt: subscription.currentPeriodEnd ?? subscription.trialEnd,
        isActive: ['active', 'trialing'].includes(subscription.status),
        billingCycle: subscription.billingCycle,
        features: getTierFeatures(subscription.productKey, subscription.tier || 'basic'),
      };
    }

    // 添加未订阅的产品（显示为无订阅状态）
    const allProducts = ['ploml', 'mopai'];
    for (const productKey of allProducts) {
      subscriptions[productKey] ??= {
        tier: null,
        status: 'none',
        expiresAt: null,
        isActive: false,
        billingCycle: null,
        features: [],
      };
    }

    const cacheValidUntil = new Date(Date.now() + 10 * 60 * 1000); // Expires after 10 minutes

    res.json({
      success: true,
      data: {
        organizationId,
        subscriptions,
        cacheValidUntil: cacheValidUntil.toISOString(),
        lastUpdated: new Date().toISOString(),
      },
    });
  } catch (error: unknown) {
    logger.error('Failed to get organization cache info:', error);
    res.status(500).json({
      error: 'server_error',
      message: 'Failed to get organization cache info',
    });
  }
}

// 更新组织信息
export async function updateOrganization(req: Request, res: Response): Promise<void> {
  try {
    const { organizationId } = req.params;
    const { name } = req.body;

    if (!organizationId) {
      res.status(400).json({
        error: 'bad_request',
        message: 'organizationId is required',
      });
      return;
    }

    if (!name) {
      res.status(400).json({
        error: 'bad_request',
        message: 'name is required',
      });
      return;
    }

    const organization = await organizationService.updateOrganization(organizationId, {
      name,
    });

    res.json({
      success: true,
      data: { organization },
    });
  } catch (error: unknown) {
    logger.error('Failed to update organization:', error);

    // Prisma错误处理
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2025') {
      res.status(404).json({
        error: 'not_found',
        message: 'Organization not found',
      });
      return;
    }

    res.status(500).json({
      error: 'server_error',
      message: 'Failed to update organization',
    });
  }
}

// 检查组织试用状态
export async function getTrialStatus(req: Request, res: Response): Promise<void> {
  try {
    const { organizationId } = req.params;

    if (!organizationId) {
      res.status(400).json({
        error: 'bad_request',
        message: 'organizationId is required',
      });
      return;
    }

    const organization = await organizationService.getOrganization(organizationId);

    if (!organization) {
      res.status(404).json({
        error: 'not_found',
        message: 'Organization not found',
      });
      return;
    }

    res.json({
      success: true,
      data: {
        hasUsedTrial: organization.hasUsedTrial,
        canStartTrial: !organization.hasUsedTrial,
        trialPeriodDays: 30,
      },
    });
  } catch (error: unknown) {
    logger.error('Failed to get trial status:', error);
    res.status(500).json({
      error: 'server_error',
      message: 'Failed to get trial status',
    });
  }
}

// 删除组织
export async function deleteOrganization(req: Request, res: Response): Promise<void> {
  try {
    const { organizationId } = req.params;

    if (!organizationId) {
      res.status(400).json({
        error: 'bad_request',
        message: 'organizationId is required',
      });
      return;
    }

    await organizationService.deleteOrganization(organizationId);

    res.json({
      success: true,
      message: 'Organization deleted, all related subscriptions canceled',
    });
  } catch (error: unknown) {
    logger.error('Failed to delete organization:', error);
    res.status(500).json({
      error: 'server_error',
      message: 'Failed to delete organization',
    });
  }
}

// 获取组织列表（管理员用）
export async function listOrganizations(req: Request, res: Response): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    if (page < 1 || limit < 1 || limit > 100) {
      res.status(400).json({
        error: 'bad_request',
        message: 'Page number must be greater than 0, items per page must be between 1-100',
      });
      return;
    }

    const result = await organizationService.listOrganizations(page, limit);

    res.json({
      success: true,
      data: result,
    });
  } catch (error: unknown) {
    logger.error('Failed to get organizations list:', error);
    res.status(500).json({
      error: 'server_error',
      message: 'Failed to get organizations list',
    });
  }
}

// 获取组织的功能权限配置
export async function getOrganizationFeatures(req: Request, res: Response): Promise<void> {
  try {
    const { organizationId } = req.params;

    if (!organizationId) {
      res.status(400).json({
        error: 'bad_request',
        message: 'organizationId is required',
      });
      return;
    }

    const features = await subscriptionService.getOrganizationFeatures(organizationId);

    if (!features) {
      res.status(404).json({
        error: 'not_found',
        message: 'No active subscription found for organization or features not configured',
      });
      return;
    }

    res.json({
      success: true,
      data: features,
    });
  } catch (error: unknown) {
    logger.error('Failed to get organization features:', error);
    res.status(500).json({
      error: 'server_error',
      message: 'Failed to get organization features',
    });
  }
}
