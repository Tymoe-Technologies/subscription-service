import { v4 as uuidv4 } from 'uuid';
import { PrismaClient, Module } from '@prisma/client';
import { stripeService } from '../../../../infra/stripe.js';
import { logger } from '../../../../utils/logger.js';
import { AppError } from '../../../../utils/errors.js';
import {
  CreateModuleParams,
  UpdateModuleParams,
  SyncModuleToStripeParams,
  ModuleDetails,
  ModuleListResponse,
  ModuleQueryParams,
} from '../../../../types/admin.js';

const prisma = new PrismaClient();

/**
 * Module 服务层
 * 处理 Module 相关的业务逻辑和 Stripe 同步
 */
export class ModuleService {
  /**
   * 创建 Module
   * 如果 syncToStripe=true，自动创建 Stripe Product 和 Price
   */
  async createModule(params: CreateModuleParams): Promise<ModuleDetails> {
    logger.info('创建 Module', { key: params.key, name: params.name });

    let module: Module | null = null;

    try {
      // 1. 检查 key 和 version 是否已存在
      const existingByKey = await prisma.module.findUnique({
        where: { key: params.key },
      });

      if (existingByKey) {
        throw new AppError(
          'duplicate_key',
          `Module with key "${params.key}" already exists`,
          409
        );
      }

      // 2. 验证依赖的 Module 是否存在
      if (params.dependencies && params.dependencies.length > 0) {
        await this.validateDependencies(params.dependencies);
      }

      // 3. 创建本地 Module 记录
      const moduleId = uuidv4();
      module = await prisma.module.create({
        data: {
          id: moduleId,
          key: params.key,
          name: params.name,
          version: params.version,
          description: params.description || null,
          monthlyPrice: params.monthlyPrice,
          dependencies: params.dependencies || [],
          allowMultiple: params.allowMultiple ?? false,
          status: params.status || 'ACTIVE',
          updatedAt: new Date(),
        },
      });

      logger.info('Module 本地记录创建成功', { moduleId: module.id });

      // 4. 如果需要同步到 Stripe
      if (params.syncToStripe !== false) {
        logger.info('开始同步 Module 到 Stripe', { moduleId: module.id });

        // 4a. 创建 Stripe Product
        const productParams: {
          name: string;
          description?: string;
          metadata: Record<string, string>;
        } = {
          name: params.name,
          metadata: {
            moduleId: module.id,
            moduleKey: params.key,
            moduleVersion: params.version,
          },
        };

        if (params.description) {
          productParams.description = params.description;
        }

        const product = await stripeService.createProduct(productParams);

        logger.info('Stripe Product 创建成功', {
          moduleId: module.id,
          productId: product.id,
        });

        // 4b. 创建 Stripe Price
        const price = await stripeService.createPrice({
          product: product.id,
          unitAmount: Math.round(params.monthlyPrice * 100), // 转换为 cents
          currency: 'cad',
          recurring: { interval: 'month' },
          metadata: {
            moduleId: module.id,
            moduleKey: params.key,
            moduleVersion: params.version,
          },
        });

        logger.info('Stripe Price 创建成功', {
          moduleId: module.id,
          priceId: price.id,
        });

        // 4c. 更新本地记录，保存 Stripe IDs
        module = await prisma.module.update({
          where: { id: module.id },
          data: {
            stripePriceId: price.id,
            stripeProductId: product.id,
            updatedAt: new Date(),
          },
        });

        logger.info('Module Stripe IDs 保存成功', {
          moduleId: module.id,
          priceId: price.id,
          productId: product.id,
        });
      }

      return this.toModuleDetails(module);
    } catch (error) {
      // 回滚：删除已创建的本地记录
      if (module) {
        logger.warn('创建 Module 失败，回滚本地记录', { moduleId: module.id });
        try {
          await prisma.module.delete({ where: { id: module.id } });
          logger.info('Module 本地记录已回滚', { moduleId: module.id });
        } catch (rollbackError) {
          logger.error('回滚 Module 失败', { moduleId: module.id, error: rollbackError });
        }
      }

      logger.error('创建 Module 失败', { error });

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        'module_creation_failed',
        error instanceof Error ? error.message : 'Failed to create Module',
        500
      );
    }
  }

  /**
   * 获取所有 Modules（支持筛选和分页）
   */
  async getAllModules(query: ModuleQueryParams): Promise<ModuleListResponse> {
    logger.info('获取 Modules 列表', query);

    try {
      const { status, limit = 20, offset = 0 } = query;

      const where = status ? { status } : {};

      const [modules, total] = await Promise.all([
        prisma.module.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.module.count({ where }),
      ]);

      logger.info('Modules 列表获取成功', {
        total,
        returned: modules.length,
        limit,
        offset,
      });

      return {
        modules: modules.map(this.toModuleDetails),
        total,
        limit,
        offset,
      };
    } catch (error) {
      logger.error('获取 Modules 列表失败', { error });

      throw new AppError(
        'modules_retrieval_failed',
        error instanceof Error ? error.message : 'Failed to retrieve Modules',
        500
      );
    }
  }

  /**
   * 根据 ID 获取单个 Module
   */
  async getModuleById(id: string): Promise<ModuleDetails> {
    logger.info('获取 Module 详情', { moduleId: id });

    try {
      const module = await prisma.module.findUnique({
        where: { id },
      });

      if (!module) {
        throw new AppError('module_not_found', `Module with ID "${id}" not found`, 404);
      }

      logger.info('Module 详情获取成功', { moduleId: id });

      return this.toModuleDetails(module);
    } catch (error) {
      logger.error('获取 Module 详情失败', { moduleId: id, error });

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        'module_retrieval_failed',
        error instanceof Error ? error.message : 'Failed to retrieve Module',
        500
      );
    }
  }

  /**
   * 更新 Module
   * 如果更新 name 或 description，自动同步到 Stripe Product
   */
  async updateModule(id: string, params: UpdateModuleParams): Promise<ModuleDetails> {
    logger.info('更新 Module', { moduleId: id, params });

    try {
      // 1. 获取现有 Module
      const existingModule = await prisma.module.findUnique({
        where: { id },
      });

      if (!existingModule) {
        throw new AppError('module_not_found', `Module with ID "${id}" not found`, 404);
      }

      // 2. 如果更新了 dependencies，验证它们
      if (params.dependencies && params.dependencies.length > 0) {
        await this.validateDependencies(params.dependencies);
      }

      // 3. 检查是否需要更新价格（价格变化需要特殊处理）
      const priceChanged = params.monthlyPrice !== undefined &&
        params.monthlyPrice !== Number(existingModule.monthlyPrice);

      // 4. 构建更新数据（排除 monthlyPrice，价格单独处理）
      const { monthlyPrice, ...otherParams } = params;
      const updateData: any = {
        ...otherParams,
        updatedAt: new Date(),
      };

      // 只在存在时才设置dependencies
      if (params.dependencies !== undefined) {
        updateData.dependencies = params.dependencies;
      }

      let updatedModule = await prisma.module.update({
        where: { id },
        data: updateData,
      });

      logger.info('Module 本地记录更新成功', { moduleId: id });

      // 5. 如果有 Stripe Product ID 且更新了 name 或 description，同步到 Stripe Product
      const shouldSyncProduct =
        existingModule.stripeProductId &&
        (params.name !== undefined || params.description !== undefined);

      if (shouldSyncProduct) {
        logger.info('同步 Module 更新到 Stripe Product', {
          moduleId: id,
          productId: existingModule.stripeProductId,
        });

        try {
          const updateProductParams: {
            name?: string;
            description?: string;
          } = {};

          if (params.name !== undefined) {
            updateProductParams.name = params.name;
          }

          if (params.description !== undefined) {
            updateProductParams.description = params.description;
          }

          await stripeService.updateProduct(existingModule.stripeProductId!, updateProductParams);

          logger.info('Stripe Product 更新成功', {
            moduleId: id,
            productId: existingModule.stripeProductId,
          });
        } catch (stripeError) {
          // Stripe 同步失败时记录错误但不回滚本地更新
          logger.error('同步 Stripe Product 失败（本地已更新）', {
            moduleId: id,
            productId: existingModule.stripeProductId,
            error: stripeError,
          });
        }
      }

      // 6. 如果价格变化，调用 syncModuleToStripe 逻辑
      if (priceChanged && monthlyPrice !== undefined) {
        logger.info('检测到价格变化，同步到 Stripe', {
          moduleId: id,
          oldPrice: existingModule.monthlyPrice.toString(),
          newPrice: monthlyPrice,
        });

        updatedModule = await this.syncModuleToStripeInternal(id, monthlyPrice);
      }

      return this.toModuleDetails(updatedModule);
    } catch (error) {
      logger.error('更新 Module 失败', { moduleId: id, error });

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        'module_update_failed',
        error instanceof Error ? error.message : 'Failed to update Module',
        500
      );
    }
  }

  /**
   * 内部方法：同步价格到 Stripe
   * 返回更新后的 Module 对象
   */
  private async syncModuleToStripeInternal(id: string, newPrice: number): Promise<Module> {
    const module = await prisma.module.findUnique({ where: { id } });
    if (!module) {
      throw new AppError('module_not_found', `Module with ID "${id}" not found`, 404);
    }

    // 如果没有 Stripe Product，先创建
    let productId = module.stripeProductId;
    if (!productId) {
      const createProductParams: {
        name: string;
        description?: string;
        metadata: Record<string, string>;
      } = {
        name: module.name,
        metadata: {
          moduleId: module.id,
          moduleKey: module.key,
          moduleVersion: module.version,
        },
      };

      if (module.description) {
        createProductParams.description = module.description;
      }

      const product = await stripeService.createProduct(createProductParams);
      productId = product.id;
    }

    // 创建新的 Stripe Price
    const newStripePrice = await stripeService.createPrice({
      product: productId,
      unitAmount: Math.round(newPrice * 100),
      currency: 'cad',
      recurring: { interval: 'month' },
      metadata: {
        moduleId: module.id,
        moduleKey: module.key,
        moduleVersion: module.version,
      },
    });

    // 如果有旧 Price，停用它
    if (module.stripePriceId) {
      try {
        await stripeService.updatePrice(module.stripePriceId, { active: false });
      } catch (error) {
        logger.warn('停用旧 Stripe Price 失败（继续执行）', { priceId: module.stripePriceId, error });
      }
    }

    // 更新本地记录
    return await prisma.module.update({
      where: { id },
      data: {
        monthlyPrice: newPrice,
        stripePriceId: newStripePrice.id,
        stripeProductId: productId,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * 同步 Module 到 Stripe（创建新 Price，停用旧 Price）
   * 用于更新价格
   */
  async syncModuleToStripe(
    id: string,
    params: SyncModuleToStripeParams
  ): Promise<ModuleDetails> {
    logger.info('同步 Module 到 Stripe', {
      moduleId: id,
      newPrice: params.monthlyPrice,
    });

    try {
      // 1. 获取现有 Module
      const module = await prisma.module.findUnique({
        where: { id },
      });

      if (!module) {
        throw new AppError('module_not_found', `Module with ID "${id}" not found`, 404);
      }

      // 2. 如果没有 Stripe Product，先创建
      let productId = module.stripeProductId;

      if (!productId) {
        logger.info('Module 没有 Stripe Product，先创建', { moduleId: id });

        const createProductParams: {
          name: string;
          description?: string;
          metadata: Record<string, string>;
        } = {
          name: module.name,
          metadata: {
            moduleId: module.id,
            moduleKey: module.key,
            moduleVersion: module.version,
          },
        };

        if (module.description) {
          createProductParams.description = module.description;
        }

        const product = await stripeService.createProduct(createProductParams);

        productId = product.id;

        logger.info('Stripe Product 创建成功', {
          moduleId: id,
          productId: product.id,
        });
      }

      // 3. 创建新的 Stripe Price
      const newPrice = await stripeService.createPrice({
        product: productId,
        unitAmount: Math.round(params.monthlyPrice * 100), // 转换为 cents
        currency: 'cad',
        recurring: { interval: 'month' },
        metadata: {
          moduleId: module.id,
          moduleKey: module.key,
          moduleVersion: module.version,
        },
      });

      logger.info('新 Stripe Price 创建成功', {
        moduleId: id,
        newPriceId: newPrice.id,
      });

      // 4. 如果有旧 Price，停用它
      if (module.stripePriceId) {
        logger.info('停用旧 Stripe Price', {
          moduleId: id,
          oldPriceId: module.stripePriceId,
        });

        try {
          await stripeService.updatePrice(module.stripePriceId, { active: false });
          logger.info('旧 Stripe Price 已停用', {
            moduleId: id,
            oldPriceId: module.stripePriceId,
          });
        } catch (error) {
          logger.warn('停用旧 Stripe Price 失败（继续执行）', {
            moduleId: id,
            oldPriceId: module.stripePriceId,
            error,
          });
        }
      }

      // 5. 更新本地记录
      const updatedModule = await prisma.module.update({
        where: { id },
        data: {
          monthlyPrice: params.monthlyPrice,
          stripePriceId: newPrice.id,
          stripeProductId: productId,
          updatedAt: new Date(),
        },
      });

      logger.info('Module 同步到 Stripe 成功', {
        moduleId: id,
        newPriceId: newPrice.id,
        productId,
      });

      return this.toModuleDetails(updatedModule);
    } catch (error) {
      logger.error('同步 Module 到 Stripe 失败', { moduleId: id, error });

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        'module_sync_failed',
        error instanceof Error ? error.message : 'Failed to sync Module to Stripe',
        500
      );
    }
  }

  /**
   * 验证依赖的 Module 是否存在
   */
  private async validateDependencies(dependencies: string[]): Promise<void> {
    logger.info('验证 Module 依赖', { dependencies });

    const modules = await prisma.module.findMany({
      where: {
        key: { in: dependencies },
      },
      select: { key: true },
    });

    const foundKeys = modules.map((m) => m.key);
    const missingKeys = dependencies.filter((key) => !foundKeys.includes(key));

    if (missingKeys.length > 0) {
      throw new AppError(
        'invalid_dependencies',
        `The following Module dependencies do not exist: ${missingKeys.join(', ')}`,
        400
      );
    }

    logger.info('Module 依赖验证通过', { dependencies });
  }

  /**
   * 删除 Module（软删除）
   * 将状态设为 SUSPENDED，同时归档 Stripe 上的 Product
   */
  async deleteModule(id: string): Promise<void> {
    logger.info('删除 Module', { moduleId: id });

    try {
      // 1. 获取现有 Module
      const module = await prisma.module.findUnique({
        where: { id },
      });

      if (!module) {
        throw new AppError('module_not_found', `Module with ID "${id}" not found`, 404);
      }

      // 2. 如果有 Stripe Product，先归档它
      if (module.stripeProductId) {
        logger.info('归档 Stripe Product', {
          moduleId: id,
          productId: module.stripeProductId,
        });

        try {
          // 先停用关联的 Price
          if (module.stripePriceId) {
            await stripeService.updatePrice(module.stripePriceId, { active: false });
            logger.info('Stripe Price 已停用', {
              moduleId: id,
              priceId: module.stripePriceId,
            });
          }

          // 归档 Product（设为 inactive）
          await stripeService.updateProduct(module.stripeProductId, { active: false });
          logger.info('Stripe Product 已归档', {
            moduleId: id,
            productId: module.stripeProductId,
          });
        } catch (stripeError) {
          logger.warn('归档 Stripe 资源失败（继续软删除本地记录）', {
            moduleId: id,
            error: stripeError,
          });
        }
      }

      // 3. 软删除：将状态设为 SUSPENDED
      await prisma.module.update({
        where: { id },
        data: {
          status: 'SUSPENDED',
          updatedAt: new Date(),
        },
      });

      logger.info('Module 软删除成功', { moduleId: id });
    } catch (error) {
      logger.error('删除 Module 失败', { moduleId: id, error });

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        'module_deletion_failed',
        error instanceof Error ? error.message : 'Failed to delete Module',
        500
      );
    }
  }

  /**
   * 转换 Prisma Module 对象为 ModuleDetails 响应格式
   */
  private toModuleDetails(module: Module): ModuleDetails {
    return {
      id: module.id,
      key: module.key,
      name: module.name,
      version: module.version,
      description: module.description,
      monthlyPrice: module.monthlyPrice.toString(),
      dependencies: module.dependencies as string[],
      allowMultiple: module.allowMultiple,
      status: module.status,
      stripePriceId: module.stripePriceId,
      stripeProductId: module.stripeProductId,
      createdAt: module.createdAt.toISOString(),
      updatedAt: module.updatedAt.toISOString(),
    };
  }
}

export const moduleService = new ModuleService();
