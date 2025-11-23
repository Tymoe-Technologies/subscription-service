import { PrismaClient } from '@prisma/client';
import { prisma } from '../../../infra/prisma.js';
import { logger } from '../../../utils/logger.js';
import { OrgModuleQuotasResponse, ModuleQuota } from '../../../types/internal.js';

/**
 * 内部 API 服务层
 * 处理微服务间调用的业务逻辑
 */
export class InternalService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = prisma;
  }

  /**
   * 获取组织的模块配额
   * 包括 Plan 自带的模块和额外购买的模块
   */
  async getOrgModuleQuotas(orgId: string): Promise<OrgModuleQuotasResponse> {
    logger.info('获取组织模块配额', { orgId });

    // 1. 查询订阅记录
    const subscription = await this.prisma.subscription.findUnique({
      where: { orgId },
      select: {
        status: true,
        items: true,
      },
    });

    // 2. 无订阅记录
    if (!subscription) {
      logger.info('组织暂无订阅', { orgId });
      return {
        orgId,
        subscriptionStatus: 'none',
        planKey: null,
        quotas: [],
      };
    }

    // 3. 解析订阅项目
    const items = subscription.items as any[];
    const subscriptionItems = Array.isArray(items) ? items : [];

    // 4. 提取 planKey 和 module 信息
    let planKey: string | null = null;
    const addonModules: Map<string, number> = new Map();

    for (const item of subscriptionItems) {
      if (item.type === 'plan') {
        planKey = item.key;
      } else if (item.type === 'module') {
        // 累加购买数量（quantity 表示购买数量）
        const quantity = item.quantity || 1;
        addonModules.set(item.key, (addonModules.get(item.key) || 0) + quantity);
      }
    }

    // 5. 查询 Plan 包含的模块（带数量）
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

    // 6. 获取所有相关模块的 allowMultiple 属性
    const planIncludedModuleKeys = planIncludedModules.map(m => m.moduleKey);
    const allModuleKeys = new Set([
      ...planIncludedModuleKeys,
      ...addonModules.keys(),
    ]);

    const modules = await this.prisma.module.findMany({
      where: {
        key: { in: Array.from(allModuleKeys) },
      },
      select: {
        key: true,
        allowMultiple: true,
      },
    });

    const moduleAllowMultipleMap = new Map<string, boolean>();
    modules.forEach((m) => {
      moduleAllowMultipleMap.set(m.key, m.allowMultiple);
    });

    // 7. 构建配额列表
    const quotas: ModuleQuota[] = [];

    // 7a. Plan 自带的模块（使用 includedModules 中的 quantity）
    for (const includedModule of planIncludedModules) {
      quotas.push({
        moduleKey: includedModule.moduleKey,
        purchasedCount: includedModule.quantity,
        allowMultiple: moduleAllowMultipleMap.get(includedModule.moduleKey) ?? false,
        source: 'plan_included',
      });
    }

    // 7b. 额外购买的模块
    for (const [moduleKey, count] of addonModules.entries()) {
      // 如果模块已经在 plan_included 中，累加数量
      if (planIncludedModuleKeys.includes(moduleKey)) {
        // 更新已有记录的数量（Plan包含+额外购买）
        const existing = quotas.find((q) => q.moduleKey === moduleKey);
        if (existing) {
          existing.purchasedCount += count;
          existing.source = 'addon'; // 有额外购买，标记为 addon
        }
      } else {
        quotas.push({
          moduleKey,
          purchasedCount: count,
          allowMultiple: moduleAllowMultipleMap.get(moduleKey) ?? false,
          source: 'addon',
        });
      }
    }

    logger.info('组织模块配额查询成功', {
      orgId,
      status: subscription.status,
      planKey,
      quotaCount: quotas.length,
    });

    return {
      orgId,
      subscriptionStatus: subscription.status,
      planKey,
      quotas,
    };
  }
}

export const internalService = new InternalService();
