import { prisma } from '../infra/prisma.js';
import { Prisma, StandardPlanStatus } from '@prisma/client';
import {
  CreateStandardPlanInput,
  UpdateStandardPlanInput,
  ListStandardPlanQuery,
} from '../validators/standardPlan.validators.js';

/**
 * Standard Plan管理Service层
 * 负责业务逻辑处理和数据库操作
 */

export class StandardPlanService {
  /**
   * 创建Standard Plan版本
   */
  async createStandardPlan(data: CreateStandardPlanInput) {
    // 1. 验证 includedModuleKeys 引用完整性
    if (data.includedModuleKeys && data.includedModuleKeys.length > 0) {
      const existingModules = await prisma.module.findMany({
        where: {
          key: { in: data.includedModuleKeys },
          status: { in: ['ACTIVE', 'COMING_SOON'] },
        },
        select: { key: true },
      });

      const existingKeys = existingModules.map((m) => m.key);
      const missingKeys = data.includedModuleKeys.filter(
        (key) => !existingKeys.includes(key)
      );

      if (missingKeys.length > 0) {
        throw {
          code: 'INVALID_MODULE_KEYS',
          message: 'Included modules do not exist or are deprecated',
          statusCode: 400,
          details: { missing: missingKeys },
        };
      }
    }

    // 2. 验证 resourceQuotas 引用完整性
    const resourceTypes = Object.keys(data.resourceQuotas);
    const existingResources = await prisma.resource.findMany({
      where: {
        type: { in: resourceTypes },
        status: 'ACTIVE',
      },
      select: { type: true },
    });

    const existingTypes = existingResources.map((r) => r.type);
    const invalidTypes = resourceTypes.filter(
      (type) => !existingTypes.includes(type)
    );

    if (invalidTypes.length > 0) {
      throw {
        code: 'INVALID_RESOURCE_QUOTAS',
        message: 'Resource quotas contain invalid resource types',
        statusCode: 400,
        details: { invalid: invalidTypes },
      };
    }

    // 3. 创建新版本为PENDING状态（待激活）
    const standardPlan = await prisma.standardPlan.create({
      data: {
        name: data.name,
        version: data.version,
        description: data.description,
        monthlyPrice: data.monthlyPrice,
        includedModuleKeys: data.includedModuleKeys,
        resourceQuotas: data.resourceQuotas,
        trialDurationDays: data.trialDurationDays,
        trialSmsQuota: data.trialSmsQuota,
        status: 'PENDING',
      },
    });

    return standardPlan;
  }

  /**
   * 查询当前ACTIVE的Standard Plan
   */
  async getActiveStandardPlan() {
    const activePlan = await prisma.standardPlan.findFirst({
      where: { status: 'ACTIVE' },
    });

    if (!activePlan) {
      throw {
        code: 'ACTIVE_STANDARD_PLAN_NOT_FOUND',
        message: 'No active Standard Plan found',
        statusCode: 404,
      };
    }

    return activePlan;
  }

  /**
   * 列出所有Standard Plan版本（分页）
   */
  async listStandardPlans(query: ListStandardPlanQuery) {
    const { page, limit, status, includeDeleted, sortBy, order } = query;

    // 构建where条件
    const where: Prisma.StandardPlanWhereInput = {};

    if (status) {
      where.status = status;
    } else if (!includeDeleted) {
      // 默认不包含DELETED
      where.status = { not: 'DELETED' };
    }

    // 查询总数
    const total = await prisma.standardPlan.count({ where });

    // 分页查询
    const plans = await prisma.standardPlan.findMany({
      where,
      orderBy: {
        [sortBy]: order,
      },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items: plans,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * 查询单个Standard Plan
   */
  async getStandardPlanById(id: string) {
    const plan = await prisma.standardPlan.findUnique({
      where: { id },
    });

    if (!plan) {
      throw {
        code: 'STANDARD_PLAN_NOT_FOUND',
        message: 'Standard Plan not found',
        statusCode: 404,
      };
    }

    return plan;
  }

  /**
   * 更新Standard Plan
   */
  async updateStandardPlan(id: string, data: UpdateStandardPlanInput) {
    // 1. 检查版本是否存在
    const plan = await this.getStandardPlanById(id);

    // 2. 状态检查：只能更新 PENDING 或 ACTIVE 状态的版本
    if (plan.status === 'ARCHIVED') {
      throw {
        code: 'CANNOT_UPDATE_ARCHIVED',
        message: 'Cannot update archived version',
        statusCode: 400,
      };
    }

    if (plan.status === 'DELETED') {
      throw {
        code: 'CANNOT_UPDATE_DELETED',
        message: 'Cannot update deleted version',
        statusCode: 400,
      };
    }

    // 3. 如果提供了includedModuleKeys，验证引用完整性
    if (data.includedModuleKeys && data.includedModuleKeys.length > 0) {
      const existingModules = await prisma.module.findMany({
        where: {
          key: { in: data.includedModuleKeys },
          status: { in: ['ACTIVE', 'COMING_SOON'] },
        },
        select: { key: true },
      });

      const existingKeys = existingModules.map((m) => m.key);
      const missingKeys = data.includedModuleKeys.filter(
        (key) => !existingKeys.includes(key)
      );

      if (missingKeys.length > 0) {
        throw {
          code: 'INVALID_MODULE_KEYS',
          message: 'Included modules do not exist or are deprecated',
          statusCode: 400,
          details: { missing: missingKeys },
        };
      }
    }

    // 3. 如果提供了resourceQuotas，验证引用完整性
    if (data.resourceQuotas) {
      const resourceTypes = Object.keys(data.resourceQuotas);
      const existingResources = await prisma.resource.findMany({
        where: {
          type: { in: resourceTypes },
          status: 'ACTIVE',
        },
        select: { type: true },
      });

      const existingTypes = existingResources.map((r) => r.type);
      const invalidTypes = resourceTypes.filter(
        (type) => !existingTypes.includes(type)
      );

      if (invalidTypes.length > 0) {
        throw {
          code: 'INVALID_RESOURCE_QUOTAS',
          message: '资源配额中包含无效的资源类型',
          statusCode: 400,
          details: { invalid: invalidTypes },
        };
      }
    }

    // 4. 如果更新的是ACTIVE版本，检查活跃订阅
    let warnings: string[] = [];
    if (plan.status === 'ACTIVE') {
      const activeSubscriptions = await prisma.subscription.count({
        where: {
          status: { in: ['TRIAL', 'ACTIVE'] },
        },
      });

      if (activeSubscriptions > 0) {
        warnings.push(
          `This Standard Plan currently has ${activeSubscriptions} active subscriptions, update may affect users`
        );
      }
    }

    // 5. 更新Standard Plan
    const updatedPlan = await prisma.standardPlan.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.version && { version: data.version }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.monthlyPrice !== undefined && { monthlyPrice: data.monthlyPrice }),
        ...(data.includedModuleKeys && { includedModuleKeys: data.includedModuleKeys }),
        ...(data.resourceQuotas && { resourceQuotas: data.resourceQuotas }),
        ...(data.trialDurationDays !== undefined && {
          trialDurationDays: data.trialDurationDays,
        }),
        ...(data.trialSmsQuota !== undefined && { trialSmsQuota: data.trialSmsQuota }),
      },
    });

    return {
      ...updatedPlan,
      ...(warnings.length > 0 && { warnings }),
    };
  }

  /**
   * 激活Standard Plan（将PENDING或ARCHIVED改为ACTIVE）
   */
  async activateStandardPlan(id: string) {
    // 1. 查询要激活的版本
    const plan = await this.getStandardPlanById(id);

    // 2. 检查状态：只能激活 PENDING 或 ARCHIVED 状态
    if (plan.status === 'ACTIVE') {
      throw {
        code: 'ALREADY_ACTIVE',
        message: 'This version is already active',
        statusCode: 400,
      };
    }

    if (plan.status === 'DELETED') {
      throw {
        code: 'CANNOT_ACTIVATE_DELETED',
        message: 'Cannot activate deleted version',
        statusCode: 400,
      };
    }

    if (plan.status !== 'PENDING' && plan.status !== 'ARCHIVED') {
      throw {
        code: 'INVALID_STATUS_FOR_ACTIVATION',
        message: 'Can only activate PENDING or ARCHIVED versions',
        statusCode: 400,
      };
    }

    // 3. 在事务中激活
    return await prisma.$transaction(async (tx) => {
      // 查询当前所有ACTIVE版本
      const currentActives = await tx.standardPlan.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, version: true },
      });

      // 安全检查：确保最多只有1个ACTIVE
      if (currentActives.length > 1) {
        throw {
          code: 'MULTIPLE_ACTIVE_PLANS',
          message: 'Data anomaly: Multiple active Standard Plans exist',
          statusCode: 500,
        };
      }

      // 将旧版本归档
      const archivedPlans = [];
      for (const activePlan of currentActives) {
        await tx.standardPlan.update({
          where: { id: activePlan.id },
          data: {
            status: 'ARCHIVED',
            archivedAt: new Date(),
          },
        });
        archivedPlans.push({
          id: activePlan.id,
          version: activePlan.version,
          archivedAt: new Date(),
        });
      }

      // 激活新版本
      const activatedPlan = await tx.standardPlan.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          activatedAt: new Date(),
          archivedAt: null, // 清除之前的归档时间
        },
      });

      return {
        ...activatedPlan,
        archivedPreviousPlan: archivedPlans.length > 0 ? archivedPlans[0] : null,
      };
    });
  }

  /**
   * 软删除Standard Plan（仅PENDING状态）
   */
  async deleteStandardPlan(id: string) {
    // 1. 查询版本
    const plan = await this.getStandardPlanById(id);

    // 2. 检查状态：只能删除 PENDING 状态
    if (plan.status === 'ACTIVE') {
      throw {
        code: 'CANNOT_DELETE_ACTIVE',
        message: 'Cannot delete currently active version',
        statusCode: 409,
      };
    }

    if (plan.status === 'ARCHIVED') {
      throw {
        code: 'CANNOT_DELETE_ARCHIVED',
        message: 'Cannot delete archived version',
        statusCode: 409,
      };
    }

    if (plan.status === 'DELETED') {
      throw {
        code: 'ALREADY_DELETED',
        message: 'This version has already been deleted',
        statusCode: 400,
      };
    }

    if (plan.status !== 'PENDING') {
      throw {
        code: 'INVALID_STATUS_FOR_DELETION',
        message: 'Can only delete PENDING versions',
        statusCode: 400,
      };
    }

    // 3. 软删除
    const deletedPlan = await prisma.standardPlan.update({
      where: { id },
      data: {
        status: 'DELETED',
        deletedAt: new Date(),
      },
      select: {
        id: true,
        name: true,
        version: true,
        status: true,
        deletedAt: true,
        updatedAt: true,
      },
    });

    return {
      ...deletedPlan,
      previousStatus: plan.status,
    };
  }
}

// 导出单例
export const standardPlanService = new StandardPlanService();
