import { prisma } from '../infra/prisma.js';
import { Prisma } from '@prisma/client';
import {
  CreateUsagePricingInput,
  UpdateUsagePricingInput,
  UpdateUsagePricingStatusInput,
  ListUsagePricingQuery,
} from '../validators/usagePricing.validators.js';

/**
 * 按量计费管理Service层
 * 负责业务逻辑处理和数据库操作
 */

export class UsagePricingService {
  /**
   * 创建按量计费规则
   */
  async createUsagePricing(data: CreateUsagePricingInput) {
    // 1. 检查usageType是否已存在
    const existing = await prisma.usagePricing.findUnique({
      where: { usageType: data.usageType },
    });

    if (existing) {
      throw {
        code: 'USAGE_TYPE_EXISTS',
        message: `Usage type '${data.usageType}' already exists`,
        statusCode: 409,
      };
    }

    // 2. 创建按量计费规则
    const usagePricing = await prisma.usagePricing.create({
      data: {
        usageType: data.usageType,
        displayName: data.displayName,
        unitPrice: data.unitPrice,
        currency: data.currency,
        isActive: data.isActive,
      },
    });

    return usagePricing;
  }

  /**
   * 列出所有按量计费规则(分页)
   */
  async listUsagePricing(query: ListUsagePricingQuery) {
    const { page, limit, isActive, sortBy, order } = query;

    // 构建where条件
    const where: Prisma.UsagePricingWhereInput = {};
    if (isActive !== undefined) where.isActive = isActive;

    // 查询总数
    const total = await prisma.usagePricing.count({ where });

    // 分页查询
    const usagePricings = await prisma.usagePricing.findMany({
      where,
      orderBy: {
        [sortBy]: order,
      },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items: usagePricings,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * 查询单个按量计费规则
   */
  async getUsagePricingById(id: string) {
    const usagePricing = await prisma.usagePricing.findUnique({
      where: { id },
    });

    if (!usagePricing) {
      throw {
        code: 'USAGE_PRICING_NOT_FOUND',
        message: 'Usage pricing not found',
        statusCode: 404,
      };
    }

    return usagePricing;
  }

  /**
   * 更新按量计费规则
   */
  async updateUsagePricing(id: string, data: UpdateUsagePricingInput) {
    // 1. 检查规则是否存在
    await this.getUsagePricingById(id);

    // 2. 更新按量计费规则
    const updatedUsagePricing = await prisma.usagePricing.update({
      where: { id },
      data: {
        ...(data.displayName && { displayName: data.displayName }),
        ...(data.unitPrice !== undefined && { unitPrice: data.unitPrice }),
      },
    });

    return updatedUsagePricing;
  }

  /**
   * 更新按量计费规则状态（启用/禁用）
   */
  async updateUsagePricingStatus(id: string, data: UpdateUsagePricingStatusInput) {
    // 1. 查询规则当前状态
    const usagePricing = await this.getUsagePricingById(id);

    // 2. 检查新状态是否与当前状态相同
    if (usagePricing.isActive === data.isActive) {
      throw {
        code: 'STATUS_UNCHANGED',
        message: `Usage pricing is already ${data.isActive ? 'enabled' : 'disabled'}`,
        statusCode: 400,
      };
    }

    // 3. 特殊检查:如果禁用,检查未结算的使用记录数量
    let warnings: string[] = [];
    if (data.isActive === false) {
      const unbilledUsages = await prisma.usage.count({
        where: {
          usageType: usagePricing.usageType,
          billedAt: null, // 未结算
        },
      });

      if (unbilledUsages > 0) {
        warnings.push(
          `This pricing rule has ${unbilledUsages} unbilled usage records. Disabling it will not affect already incurred charges`
        );
      }
    }

    // 4. 更新状态
    const updatedUsagePricing = await prisma.usagePricing.update({
      where: { id },
      data: {
        isActive: data.isActive,
      },
      select: {
        id: true,
        usageType: true,
        displayName: true,
        unitPrice: true,
        currency: true,
        isActive: true,
        updatedAt: true,
      },
    });

    return {
      ...updatedUsagePricing,
      previousStatus: usagePricing.isActive,
      ...(warnings.length > 0 && { warnings }),
    };
  }
}

// 导出单例
export const usagePricingService = new UsagePricingService();
