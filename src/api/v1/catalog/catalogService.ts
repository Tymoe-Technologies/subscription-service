import { prisma } from '../../../infra/prisma.js';
import { logger } from '../../../utils/logger.js';
import { AppError } from '../../../utils/errors.js';
import type { Plan, Module } from '@prisma/client';

/**
 * 公开 Plan 信息（不包含敏感字段）
 */
export interface PublicPlan {
  key: string;
  name: string;
  description: string | null;
  monthlyPrice: string;
  includedModules: { moduleKey: string; quantity: number }[];
  trialDurationDays: number;
}

/**
 * 公开 Module 信息（不包含敏感字段）
 */
export interface PublicModule {
  key: string;
  name: string;
  description: string | null;
  monthlyPrice: string;
  dependencies: string[];
  allowMultiple: boolean;
}

/**
 * Catalog Service
 * 提供公开的产品目录查询（无需认证）
 */
class CatalogService {
  /**
   * 获取所有可用的 Plans（状态为 ACTIVE）
   */
  async getActivePlans(): Promise<PublicPlan[]> {
    logger.info('获取所有可用 Plans');

    const plans = await prisma.plan.findMany({
      where: {
        status: 'ACTIVE',
      },
      orderBy: {
        monthlyPrice: 'asc',
      },
    });

    return plans.map((plan) => this.toPublicPlan(plan));
  }

  /**
   * 根据 key 获取单个 Plan（必须为 ACTIVE 状态）
   */
  async getPlanByKey(key: string): Promise<PublicPlan> {
    logger.info('根据 key 获取 Plan', { key });

    const plan = await prisma.plan.findFirst({
      where: {
        key,
        status: 'ACTIVE',
      },
    });

    if (!plan) {
      throw new AppError(
        'plan_not_found',
        'Plan not found or not available',
        404
      );
    }

    return this.toPublicPlan(plan);
  }

  /**
   * 获取所有可用的 Modules（状态为 ACTIVE）
   */
  async getActiveModules(): Promise<PublicModule[]> {
    logger.info('获取所有可用 Modules');

    const modules = await prisma.module.findMany({
      where: {
        status: 'ACTIVE',
      },
      orderBy: {
        monthlyPrice: 'asc',
      },
    });

    return modules.map((mod) => this.toPublicModule(mod));
  }

  /**
   * 根据 key 获取单个 Module（必须为 ACTIVE 状态）
   */
  async getModuleByKey(key: string): Promise<PublicModule> {
    logger.info('根据 key 获取 Module', { key });

    const mod = await prisma.module.findFirst({
      where: {
        key,
        status: 'ACTIVE',
      },
    });

    if (!mod) {
      throw new AppError(
        'module_not_found',
        'Module not found or not available',
        404
      );
    }

    return this.toPublicModule(mod);
  }

  /**
   * 将数据库 Plan 转换为公开格式（移除敏感字段）
   */
  private toPublicPlan(plan: Plan): PublicPlan {
    // 解析 includedModules（Prisma 返回 JsonValue 类型）
    let includedModules: { moduleKey: string; quantity: number }[] = [];
    if (plan.includedModules) {
      if (Array.isArray(plan.includedModules)) {
        includedModules = plan.includedModules as { moduleKey: string; quantity: number }[];
      }
    }

    return {
      key: plan.key,
      name: plan.name,
      description: plan.description,
      monthlyPrice: plan.monthlyPrice.toString(),
      includedModules,
      trialDurationDays: plan.trialDurationDays,
    };
  }

  /**
   * 将数据库 Module 转换为公开格式（移除敏感字段）
   */
  private toPublicModule(mod: Module): PublicModule {
    // 解析 dependencies（Prisma 返回 JsonValue 类型）
    let dependencies: string[] = [];
    if (mod.dependencies) {
      if (Array.isArray(mod.dependencies)) {
        dependencies = mod.dependencies as string[];
      }
    }

    return {
      key: mod.key,
      name: mod.name,
      description: mod.description,
      monthlyPrice: mod.monthlyPrice.toString(),
      dependencies,
      allowMultiple: mod.allowMultiple,
    };
  }
}

export const catalogService = new CatalogService();
