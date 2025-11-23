import { v4 as uuidv4 } from 'uuid';
import { PrismaClient, Plan } from '@prisma/client';
import { stripeService } from '../../../../infra/stripe.js';
import { logger } from '../../../../utils/logger.js';
import { AppError } from '../../../../utils/errors.js';
import {
  CreatePlanParams,
  UpdatePlanParams,
  SyncPlanToStripeParams,
  PlanDetails,
  PlanListResponse,
  PlanQueryParams,
  IncludedModule,
} from '../../../../types/admin.js';
import { env } from '../../../../config/config.js';

const prisma = new PrismaClient();

/**
 * Plan 服务层
 * 处理 Plan 相关的业务逻辑和 Stripe 同步
 */
export class PlanService {
  /**
   * 创建 Plan
   * 如果 syncToStripe=true，自动创建 Stripe Product 和 Price
   */
  async createPlan(params: CreatePlanParams): Promise<PlanDetails> {
    logger.info('创建 Plan', { key: params.key, name: params.name });

    let plan: Plan | null = null;

    try {
      // 1. 检查 key 和 version 是否已存在
      const existingByKey = await prisma.plan.findUnique({
        where: { key: params.key },
      });

      if (existingByKey) {
        throw new AppError(
          'duplicate_key',
          `Plan with key "${params.key}" already exists`,
          409
        );
      }

      // 2. 创建本地 Plan 记录
      const planId = uuidv4();
      plan = await prisma.plan.create({
        data: {
          id: planId,
          key: params.key,
          name: params.name,
          version: params.version,
          description: params.description || null,
          monthlyPrice: params.monthlyPrice,
          includedModules: (params.includedModules || []) as any,
          trialDurationDays: params.trialDurationDays,
          status: params.status || 'ACTIVE',
          updatedAt: new Date(),
        },
      });

      logger.info('Plan 本地记录创建成功', { planId: plan.id });

      // 3. 如果需要同步到 Stripe
      if (params.syncToStripe !== false) {
        logger.info('开始同步 Plan 到 Stripe', { planId: plan.id });

        // 3a. 创建 Stripe Product
        const productParams: {
          name: string;
          description?: string;
          metadata: Record<string, string>;
        } = {
          name: params.name,
          metadata: {
            planId: plan.id,
            planKey: params.key,
            planVersion: params.version,
          },
        };

        if (params.description) {
          productParams.description = params.description;
        }

        const product = await stripeService.createProduct(productParams);

        logger.info('Stripe Product 创建成功', {
          planId: plan.id,
          productId: product.id,
        });

        // 3b. 创建 Stripe Price
        const price = await stripeService.createPrice({
          product: product.id,
          unitAmount: Math.round(params.monthlyPrice * 100), // 转换为 cents
          currency: 'cad', // 默认货币
          recurring: { interval: 'month' },
          metadata: {
            planId: plan.id,
            planKey: params.key,
            planVersion: params.version,
          },
        });

        logger.info('Stripe Price 创建成功', {
          planId: plan.id,
          priceId: price.id,
        });

        // 3c. 更新本地记录，保存 Stripe IDs
        plan = await prisma.plan.update({
          where: { id: plan.id },
          data: {
            stripePriceId: price.id,
            stripeProductId: product.id,
            updatedAt: new Date(),
          },
        });

        logger.info('Plan Stripe IDs 保存成功', {
          planId: plan.id,
          priceId: price.id,
          productId: product.id,
        });
      }

      return this.toPlanDetails(plan);
    } catch (error) {
      // 回滚：删除已创建的本地记录
      if (plan) {
        logger.warn('创建 Plan 失败，回滚本地记录', { planId: plan.id });
        try {
          await prisma.plan.delete({ where: { id: plan.id } });
          logger.info('Plan 本地记录已回滚', { planId: plan.id });
        } catch (rollbackError) {
          logger.error('回滚 Plan 失败', { planId: plan.id, error: rollbackError });
        }
      }

      logger.error('创建 Plan 失败', { error });

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        'plan_creation_failed',
        error instanceof Error ? error.message : 'Failed to create Plan',
        500
      );
    }
  }

  /**
   * 获取所有 Plans（支持筛选和分页）
   */
  async getAllPlans(query: PlanQueryParams): Promise<PlanListResponse> {
    logger.info('获取 Plans 列表', query);

    try {
      const { status, limit = 20, offset = 0 } = query;

      const where = status ? { status } : {};

      const [plans, total] = await Promise.all([
        prisma.plan.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.plan.count({ where }),
      ]);

      logger.info('Plans 列表获取成功', {
        total,
        returned: plans.length,
        limit,
        offset,
      });

      return {
        plans: plans.map(this.toPlanDetails),
        total,
        limit,
        offset,
      };
    } catch (error) {
      logger.error('获取 Plans 列表失败', { error });

      throw new AppError(
        'plans_retrieval_failed',
        error instanceof Error ? error.message : 'Failed to retrieve Plans',
        500
      );
    }
  }

  /**
   * 根据 ID 获取单个 Plan
   */
  async getPlanById(id: string): Promise<PlanDetails> {
    logger.info('获取 Plan 详情', { planId: id });

    try {
      const plan = await prisma.plan.findUnique({
        where: { id },
      });

      if (!plan) {
        throw new AppError('plan_not_found', `Plan with ID "${id}" not found`, 404);
      }

      logger.info('Plan 详情获取成功', { planId: id });

      return this.toPlanDetails(plan);
    } catch (error) {
      logger.error('获取 Plan 详情失败', { planId: id, error });

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        'plan_retrieval_failed',
        error instanceof Error ? error.message : 'Failed to retrieve Plan',
        500
      );
    }
  }

  /**
   * 更新 Plan
   * 如果更新 name 或 description，自动同步到 Stripe Product
   * 如果更新 monthlyPrice，自动创建新的 Stripe Price 并停用旧的
   */
  async updatePlan(id: string, params: UpdatePlanParams): Promise<PlanDetails> {
    logger.info('更新 Plan', { planId: id, params });

    try {
      // 1. 获取现有 Plan
      const existingPlan = await prisma.plan.findUnique({
        where: { id },
      });

      if (!existingPlan) {
        throw new AppError('plan_not_found', `Plan with ID "${id}" not found`, 404);
      }

      // 2. 检查是否需要更新价格（价格变化需要特殊处理）
      const priceChanged = params.monthlyPrice !== undefined &&
        params.monthlyPrice !== Number(existingPlan.monthlyPrice);

      // 3. 构建更新数据（排除 monthlyPrice，价格单独处理）
      const { monthlyPrice, ...otherParams } = params;
      const updateData: any = {
        ...otherParams,
        updatedAt: new Date(),
      };

      // 只在存在时才设置includedModules
      if (params.includedModules !== undefined) {
        updateData.includedModules = params.includedModules;
      }

      let updatedPlan = await prisma.plan.update({
        where: { id },
        data: updateData,
      });

      logger.info('Plan 本地记录更新成功', { planId: id });

      // 4. 如果有 Stripe Product ID 且更新了 name 或 description，同步到 Stripe Product
      const shouldSyncProduct =
        existingPlan.stripeProductId &&
        (params.name !== undefined || params.description !== undefined);

      if (shouldSyncProduct) {
        logger.info('同步 Plan 更新到 Stripe Product', {
          planId: id,
          productId: existingPlan.stripeProductId,
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

          await stripeService.updateProduct(existingPlan.stripeProductId!, updateProductParams);

          logger.info('Stripe Product 更新成功', {
            planId: id,
            productId: existingPlan.stripeProductId,
          });
        } catch (stripeError) {
          // Stripe 同步失败时记录错误但不回滚本地更新
          logger.error('同步 Stripe Product 失败（本地已更新）', {
            planId: id,
            productId: existingPlan.stripeProductId,
            error: stripeError,
          });
        }
      }

      // 5. 如果价格变化，调用 syncPlanToStripe 逻辑
      if (priceChanged && monthlyPrice !== undefined) {
        logger.info('检测到价格变化，同步到 Stripe', {
          planId: id,
          oldPrice: existingPlan.monthlyPrice.toString(),
          newPrice: monthlyPrice,
        });

        // 直接调用 syncPlanToStripe 逻辑
        updatedPlan = await this.syncPlanToStripeInternal(id, monthlyPrice);
      }

      return this.toPlanDetails(updatedPlan);
    } catch (error) {
      logger.error('更新 Plan 失败', { planId: id, error });

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        'plan_update_failed',
        error instanceof Error ? error.message : 'Failed to update Plan',
        500
      );
    }
  }

  /**
   * 内部方法：同步价格到 Stripe
   * 返回更新后的 Plan 对象
   */
  private async syncPlanToStripeInternal(id: string, newPrice: number): Promise<Plan> {
    const plan = await prisma.plan.findUnique({ where: { id } });
    if (!plan) {
      throw new AppError('plan_not_found', `Plan with ID "${id}" not found`, 404);
    }

    // 如果没有 Stripe Product，先创建
    let productId = plan.stripeProductId;
    if (!productId) {
      const createProductParams: {
        name: string;
        description?: string;
        metadata: Record<string, string>;
      } = {
        name: plan.name,
        metadata: {
          planId: plan.id,
          planKey: plan.key,
          planVersion: plan.version,
        },
      };

      if (plan.description) {
        createProductParams.description = plan.description;
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
        planId: plan.id,
        planKey: plan.key,
        planVersion: plan.version,
      },
    });

    // 如果有旧 Price，停用它
    if (plan.stripePriceId) {
      try {
        await stripeService.updatePrice(plan.stripePriceId, { active: false });
      } catch (error) {
        logger.warn('停用旧 Stripe Price 失败（继续执行）', { priceId: plan.stripePriceId, error });
      }
    }

    // 更新本地记录
    return await prisma.plan.update({
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
   * 同步 Plan 到 Stripe（创建新 Price，停用旧 Price）
   * 用于更新价格
   */
  async syncPlanToStripe(
    id: string,
    params: SyncPlanToStripeParams
  ): Promise<PlanDetails> {
    logger.info('同步 Plan 到 Stripe', { planId: id, newPrice: params.monthlyPrice });

    try {
      // 1. 获取现有 Plan
      const plan = await prisma.plan.findUnique({
        where: { id },
      });

      if (!plan) {
        throw new AppError('plan_not_found', `Plan with ID "${id}" not found`, 404);
      }

      // 2. 如果没有 Stripe Product，先创建
      let productId = plan.stripeProductId;

      if (!productId) {
        logger.info('Plan 没有 Stripe Product，先创建', { planId: id });

        const createProductParams: {
          name: string;
          description?: string;
          metadata: Record<string, string>;
        } = {
          name: plan.name,
          metadata: {
            planId: plan.id,
            planKey: plan.key,
            planVersion: plan.version,
          },
        };

        if (plan.description) {
          createProductParams.description = plan.description;
        }

        const product = await stripeService.createProduct(createProductParams);

        productId = product.id;

        logger.info('Stripe Product 创建成功', {
          planId: id,
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
          planId: plan.id,
          planKey: plan.key,
          planVersion: plan.version,
        },
      });

      logger.info('新 Stripe Price 创建成功', {
        planId: id,
        newPriceId: newPrice.id,
      });

      // 4. 如果有旧 Price，停用它
      if (plan.stripePriceId) {
        logger.info('停用旧 Stripe Price', {
          planId: id,
          oldPriceId: plan.stripePriceId,
        });

        try {
          await stripeService.updatePrice(plan.stripePriceId, { active: false });
          logger.info('旧 Stripe Price 已停用', {
            planId: id,
            oldPriceId: plan.stripePriceId,
          });
        } catch (error) {
          logger.warn('停用旧 Stripe Price 失败（继续执行）', {
            planId: id,
            oldPriceId: plan.stripePriceId,
            error,
          });
        }
      }

      // 5. 更新本地记录
      const updatedPlan = await prisma.plan.update({
        where: { id },
        data: {
          monthlyPrice: params.monthlyPrice,
          stripePriceId: newPrice.id,
          stripeProductId: productId,
          updatedAt: new Date(),
        },
      });

      logger.info('Plan 同步到 Stripe 成功', {
        planId: id,
        newPriceId: newPrice.id,
        productId,
      });

      return this.toPlanDetails(updatedPlan);
    } catch (error) {
      logger.error('同步 Plan 到 Stripe 失败', { planId: id, error });

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        'plan_sync_failed',
        error instanceof Error ? error.message : 'Failed to sync Plan to Stripe',
        500
      );
    }
  }

  /**
   * 删除 Plan
   * 同时删除 Stripe 上的 Product（如果存在）
   */
  async deletePlan(id: string): Promise<void> {
    logger.info('删除 Plan', { planId: id });

    try {
      // 1. 获取现有 Plan
      const plan = await prisma.plan.findUnique({
        where: { id },
      });

      if (!plan) {
        throw new AppError('plan_not_found', `Plan with ID "${id}" not found`, 404);
      }

      // 2. 如果有 Stripe Product，先归档它（Stripe 不支持直接删除已有 Price 的 Product）
      if (plan.stripeProductId) {
        logger.info('归档 Stripe Product', {
          planId: id,
          productId: plan.stripeProductId,
        });

        try {
          // 先停用关联的 Price
          if (plan.stripePriceId) {
            await stripeService.updatePrice(plan.stripePriceId, { active: false });
            logger.info('Stripe Price 已停用', {
              planId: id,
              priceId: plan.stripePriceId,
            });
          }

          // 归档 Product（设为 inactive）
          await stripeService.updateProduct(plan.stripeProductId, { active: false });
          logger.info('Stripe Product 已归档', {
            planId: id,
            productId: plan.stripeProductId,
          });
        } catch (stripeError) {
          logger.warn('归档 Stripe 资源失败（继续删除本地记录）', {
            planId: id,
            error: stripeError,
          });
        }
      }

      // 3. 软删除：将状态设为 DELETED
      await prisma.plan.update({
        where: { id },
        data: {
          status: 'DELETED',
          updatedAt: new Date(),
        },
      });

      logger.info('Plan 软删除成功', { planId: id });
    } catch (error) {
      logger.error('删除 Plan 失败', { planId: id, error });

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        'plan_deletion_failed',
        error instanceof Error ? error.message : 'Failed to delete Plan',
        500
      );
    }
  }

  /**
   * 转换 Prisma Plan 对象为 PlanDetails 响应格式
   */
  private toPlanDetails(plan: Plan): PlanDetails {
    return {
      id: plan.id,
      key: plan.key,
      name: plan.name,
      version: plan.version,
      description: plan.description,
      monthlyPrice: plan.monthlyPrice.toString(),
      includedModules: (plan.includedModules as unknown) as IncludedModule[],
      trialDurationDays: plan.trialDurationDays,
      status: plan.status,
      stripePriceId: plan.stripePriceId,
      stripeProductId: plan.stripeProductId,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
    };
  }
}

export const planService = new PlanService();
