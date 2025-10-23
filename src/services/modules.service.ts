import { prisma } from '../infra/prisma.js';
import { Prisma, ModuleStatus } from '@prisma/client';
import {
  CreateModuleInput,
  UpdateModuleInput,
  UpdateModuleStatusInput,
  ListModulesQuery,
} from '../validators/modules.validators.js';

/**
 * 模块管理Service层
 * 负责业务逻辑处理和数据库操作
 */

export class ModulesService {
  /**
   * 创建模块
   */
  async createModule(data: CreateModuleInput) {
    // 1. 检查key是否已存在
    const existing = await prisma.module.findUnique({
      where: { key: data.key },
    });

    if (existing) {
      throw {
        code: 'MODULE_KEY_EXISTS',
        message: `Module key '${data.key}' already exists`,
        statusCode: 409,
      };
    }

    // 2. 检查dependencies中的模块是否都存在
    if (data.dependencies && data.dependencies.length > 0) {
      const existingModules = await prisma.module.findMany({
        where: {
          key: {
            in: data.dependencies,
          },
        },
        select: { key: true },
      });

      const existingKeys = existingModules.map((m) => m.key);
      const missingKeys = data.dependencies.filter((key) => !existingKeys.includes(key));

      if (missingKeys.length > 0) {
        throw {
          code: 'INVALID_DEPENDENCIES',
          message: 'Dependent modules do not exist',
          statusCode: 400,
          details: {
            missing: missingKeys,
          },
        };
      }
    }

    // 3. 创建模块
    const module = await prisma.module.create({
      data: {
        key: data.key,
        name: data.name,
        description: data.description,
        category: data.category,
        monthlyPrice: data.monthlyPrice,
        pricingModel: data.pricingModel,
        dependencies: data.dependencies || [],
        status: data.status as ModuleStatus,
      },
    });

    return module;
  }

  /**
   * 列出所有模块(分页)
   */
  async listModules(query: ListModulesQuery) {
    const { page, limit, category, status, sortBy, order } = query;

    // 构建where条件
    const where: Prisma.ModuleWhereInput = {};
    if (category) where.category = category;
    if (status) where.status = status as ModuleStatus;

    // 查询总数
    const total = await prisma.module.count({ where });

    // 分页查询
    const modules = await prisma.module.findMany({
      where,
      orderBy: {
        [sortBy]: order,
      },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items: modules,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * 查询单个模块
   */
  async getModuleById(id: string) {
    const module = await prisma.module.findUnique({
      where: { id },
    });

    if (!module) {
      throw {
        code: 'MODULE_NOT_FOUND',
        message: 'Module not found',
        statusCode: 404,
      };
    }

    return module;
  }

  /**
   * 更新模块
   */
  async updateModule(id: string, data: UpdateModuleInput) {
    // 1. 检查模块是否存在
    await this.getModuleById(id);

    // 2. 如果更新dependencies,检查依赖模块是否都存在
    if (data.dependencies && data.dependencies.length > 0) {
      const existingModules = await prisma.module.findMany({
        where: {
          key: {
            in: data.dependencies,
          },
        },
        select: { key: true },
      });

      const existingKeys = existingModules.map((m) => m.key);
      const missingKeys = data.dependencies.filter((key) => !existingKeys.includes(key));

      if (missingKeys.length > 0) {
        throw {
          code: 'INVALID_DEPENDENCIES',
          message: 'Dependent modules do not exist',
          statusCode: 400,
          details: {
            missing: missingKeys,
          },
        };
      }
    }

    // 3. 更新模块
    const updatedModule = await prisma.module.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.category && { category: data.category }),
        ...(data.monthlyPrice !== undefined && { monthlyPrice: data.monthlyPrice }),
        ...(data.pricingModel && { pricingModel: data.pricingModel }),
        ...(data.dependencies !== undefined && { dependencies: data.dependencies }),
      },
    });

    return updatedModule;
  }

  /**
   * 删除模块(软删除)
   */
  async deleteModule(id: string) {
    // 1. 检查模块是否存在
    const module = await this.getModuleById(id);

    // 2. 检查是否有活跃订阅使用此模块
    const activeSubscriptions = await prisma.subscriptionModule.count({
      where: {
        moduleId: id,
        isActive: true,
      },
    });

    if (activeSubscriptions > 0) {
      throw {
        code: 'MODULE_IN_USE',
        message: 'Cannot delete module in use',
        statusCode: 409,
        details: {
          activeSubscriptions,
          reason: `${activeSubscriptions} active subscriptions are using this module`,
        },
      };
    }

    // 3. 检查是否有其他模块依赖此模块
    const dependentModules = await prisma.module.findMany({
      where: {
        dependencies: {
          array_contains: module.key,
        },
      },
      select: { key: true, name: true },
    });

    if (dependentModules.length > 0) {
      throw {
        code: 'MODULE_HAS_DEPENDENTS',
        message: 'Cannot delete module with dependencies',
        statusCode: 409,
        details: {
          dependentModules: dependentModules.map((m) => m.key),
          reason: `${dependentModules.length} modules depend on this module`,
        },
      };
    }

    // 4. 软删除:更新状态为DEPRECATED
    const deletedModule = await prisma.module.update({
      where: { id },
      data: {
        status: ModuleStatus.DEPRECATED,
      },
      select: {
        id: true,
        key: true,
        name: true,
        status: true,
        updatedAt: true,
      },
    });

    return deletedModule;
  }

  /**
   * 更新模块状态
   */
  async updateModuleStatus(id: string, data: UpdateModuleStatusInput) {
    // 1. 查询模块当前状态
    const module = await this.getModuleById(id);

    // 2. 检查新状态是否与当前状态相同
    if (module.status === data.status) {
      throw {
        code: 'STATUS_UNCHANGED',
        message: `Module is already in ${data.status} status`,
        statusCode: 400,
      };
    }

    // 3. 状态转换规则检查(可选,根据业务需求)
    const allowedTransitions: Record<string, string[]> = {
      ACTIVE: ['DEPRECATED', 'SUSPENDED'],
      DEPRECATED: ['ACTIVE'],
      SUSPENDED: ['ACTIVE'],
      COMING_SOON: ['ACTIVE'],
    };

    const allowed = allowedTransitions[module.status];
    if (allowed && !allowed.includes(data.status)) {
      throw {
        code: 'INVALID_STATUS_TRANSITION',
        message: `Cannot transition from ${module.status} to ${data.status}`,
        statusCode: 400,
      };
    }

    // 4. 特殊检查:如果设为SUSPENDED,检查活跃订阅数量
    let warnings: string[] = [];
    if (data.status === 'SUSPENDED') {
      const activeSubscriptions = await prisma.subscriptionModule.count({
        where: {
          moduleId: id,
          isActive: true,
        },
      });

      if (activeSubscriptions > 0) {
        warnings.push(`This module has ${activeSubscriptions} active subscriptions, status change may affect users`);
      }
    }

    // 5. 更新状态
    const updatedModule = await prisma.module.update({
      where: { id },
      data: {
        status: data.status as ModuleStatus,
      },
      select: {
        id: true,
        key: true,
        name: true,
        status: true,
        updatedAt: true,
      },
    });

    return {
      ...updatedModule,
      previousStatus: module.status,
      ...(warnings.length > 0 && { warnings }),
    };
  }
}

// 导出单例
export const modulesService = new ModulesService();
