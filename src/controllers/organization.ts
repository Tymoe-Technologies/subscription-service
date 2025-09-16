import { Request, Response } from 'express';
import { organizationService } from '../services/organization.js';
import { getTierFeatures } from '../config/features.js';

// 创建组织
export async function createOrganization(req: Request, res: Response): Promise<void> {
  try {
    const { id, name, email } = req.body;

    if (!id || !name || !email) {
      res.status(400).json({
        error: 'bad_request',
        message: 'id, name 和 email 是必需的',
      });
      return;
    }

    const organization = await organizationService.createOrganization({
      id,
      name,
      email,
    });

    res.status(201).json({
      success: true,
      data: { organization },
    });
  } catch (error: any) {
    console.error('创建组织失败:', error);
    
    if (error.message.includes('已存在')) {
      res.status(409).json({
        error: 'conflict',
        message: error.message,
      });
      return;
    }

    res.status(500).json({
      error: 'server_error',
      message: '创建组织失败',
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
        message: 'organizationId 是必需的',
      });
      return;
    }

    const organization = await organizationService.getOrganization(organizationId);

    if (!organization) {
      res.status(404).json({
        error: 'not_found',
        message: '组织不存在',
      });
      return;
    }

    res.json({
      success: true,
      data: { organization },
    });
  } catch (error: any) {
    console.error('获取组织信息失败:', error);
    res.status(500).json({
      error: 'server_error',
      message: '获取组织信息失败',
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
        message: 'organizationId 是必需的',
      });
      return;
    }

    const organization = await organizationService.getOrganizationWithSubscriptions(organizationId);

    if (!organization) {
      res.status(404).json({
        error: 'not_found',
        message: '组织不存在',
      });
      return;
    }

    // 为每个订阅添加功能列表
    const enrichedOrganization = {
      ...organization,
      subscriptions: organization.subscriptions.map(subscription => ({
        ...subscription,
        features: getTierFeatures(subscription.productKey, subscription.tier),
        isActive: ['active', 'trialing'].includes(subscription.status)
      }))
    };

    res.json({
      success: true,
      data: { organization: enrichedOrganization },
    });
  } catch (error: any) {
    console.error('获取组织订阅信息失败:', error);
    res.status(500).json({
      error: 'server_error',
      message: '获取组织订阅信息失败',
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
        message: 'organizationId 是必需的',
      });
      return;
    }

    const organization = await organizationService.getOrganizationWithSubscriptions(organizationId);

    if (!organization) {
      res.status(404).json({
        error: 'not_found',
        message: '组织不存在',
      });
      return;
    }

    // 构建前端缓存友好的数据格式
    const subscriptions: Record<string, any> = {};
    
    for (const subscription of organization.subscriptions) {
      subscriptions[subscription.productKey] = {
        tier: subscription.tier,
        status: subscription.status,
        expiresAt: subscription.currentPeriodEnd || subscription.trialEnd,
        isActive: ['active', 'trialing'].includes(subscription.status),
        billingCycle: subscription.billingCycle,
        features: getTierFeatures(subscription.productKey, subscription.tier)
      };
    }

    // 添加未订阅的产品（显示为无订阅状态）
    const allProducts = ['ploml', 'mopai'];
    for (const productKey of allProducts) {
      if (!subscriptions[productKey]) {
        subscriptions[productKey] = {
          tier: null,
          status: 'none',
          expiresAt: null,
          isActive: false,
          billingCycle: null,
          features: []
        };
      }
    }

    const cacheValidUntil = new Date(Date.now() + 10 * 60 * 1000); // 10分钟后过期

    res.json({
      success: true,
      data: {
        organizationId,
        subscriptions,
        cacheValidUntil: cacheValidUntil.toISOString(),
        lastUpdated: new Date().toISOString()
      },
    });
  } catch (error: any) {
    console.error('获取组织缓存信息失败:', error);
    res.status(500).json({
      error: 'server_error',
      message: '获取组织缓存信息失败',
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
        message: 'organizationId 是必需的',
      });
      return;
    }

    if (!name) {
      res.status(400).json({
        error: 'bad_request',
        message: 'name 是必需的',
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
  } catch (error: any) {
    console.error('更新组织信息失败:', error);
    
    // Prisma错误处理
    if (error.code === 'P2025') {
      res.status(404).json({
        error: 'not_found',
        message: '组织不存在',
      });
      return;
    }

    res.status(500).json({
      error: 'server_error',
      message: '更新组织信息失败',
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
        message: 'organizationId 是必需的',
      });
      return;
    }

    const organization = await organizationService.getOrganization(organizationId);

    if (!organization) {
      res.status(404).json({
        error: 'not_found',
        message: '组织不存在',
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
  } catch (error: any) {
    console.error('获取试用状态失败:', error);
    res.status(500).json({
      error: 'server_error',
      message: '获取试用状态失败',
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
        message: 'organizationId 是必需的',
      });
      return;
    }

    await organizationService.deleteOrganization(organizationId);

    res.json({
      success: true,
      message: '组织已删除，所有相关订阅已取消',
    });
  } catch (error: any) {
    console.error('删除组织失败:', error);
    res.status(500).json({
      error: 'server_error',
      message: '删除组织失败',
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
        message: '页码必须大于0，每页数量必须在1-100之间',
      });
      return;
    }

    const result = await organizationService.listOrganizations(page, limit);

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('获取组织列表失败:', error);
    res.status(500).json({
      error: 'server_error',
      message: '获取组织列表失败',
    });
  }
}