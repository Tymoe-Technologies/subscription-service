import { prisma } from '../infra/prisma.js';
import { Prisma, ResourceStatus } from '@prisma/client';
import {
  CreateResourceInput,
  UpdateResourceInput,
  UpdateResourceStatusInput,
  ListResourcesQuery,
} from '../validators/resources.validators.js';

/**
 * 资源管理Service层
 * 负责业务逻辑处理和数据库操作
 */

export class ResourcesService {
  /**
   * 创建资源
   */
  async createResource(data: CreateResourceInput) {
    // 1. 检查type是否已存在
    const existing = await prisma.resource.findUnique({
      where: { type: data.type },
    });

    if (existing) {
      throw {
        code: 'RESOURCE_TYPE_EXISTS',
        message: `Resource type '${data.type}' already exists`,
        statusCode: 409,
      };
    }

    // 2. 创建资源
    const resource = await prisma.resource.create({
      data: {
        type: data.type,
        category: data.category,
        name: data.name,
        monthlyPrice: data.monthlyPrice,
        standardQuota: data.standardQuota,
        status: data.status as ResourceStatus,
      },
    });

    return resource;
  }

  /**
   * 列出所有资源(分页)
   */
  async listResources(query: ListResourcesQuery) {
    const { page, limit, category, status, sortBy, order } = query;

    // 构建where条件
    const where: Prisma.ResourceWhereInput = {};
    if (category) where.category = category;
    if (status) where.status = status as ResourceStatus;

    // 查询总数
    const total = await prisma.resource.count({ where });

    // 分页查询
    const resources = await prisma.resource.findMany({
      where,
      orderBy: {
        [sortBy]: order,
      },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items: resources,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * 查询单个资源
   */
  async getResourceById(id: string) {
    const resource = await prisma.resource.findUnique({
      where: { id },
    });

    if (!resource) {
      throw {
        code: 'RESOURCE_NOT_FOUND',
        message: 'Resource not found',
        statusCode: 404,
      };
    }

    return resource;
  }

  /**
   * 更新资源
   */
  async updateResource(id: string, data: UpdateResourceInput) {
    // 1. 检查资源是否存在
    await this.getResourceById(id);

    // 2. 更新资源
    const updatedResource = await prisma.resource.update({
      where: { id },
      data: {
        ...(data.category && { category: data.category }),
        ...(data.name && { name: data.name }),
        ...(data.monthlyPrice !== undefined && { monthlyPrice: data.monthlyPrice }),
        ...(data.standardQuota !== undefined && { standardQuota: data.standardQuota }),
      },
    });

    return updatedResource;
  }

  /**
   * 删除资源(软删除)
   */
  async deleteResource(id: string) {
    // 1. 检查资源是否存在
    const resource = await this.getResourceById(id);

    // 2. 检查是否有活跃订阅使用此资源
    const activeSubscriptions = await prisma.subscriptionResource.count({
      where: {
        resourceId: id,
        removedAt: null, // 未移除的资源
      },
    });

    if (activeSubscriptions > 0) {
      throw {
        code: 'RESOURCE_IN_USE',
        message: 'Cannot delete resource in use',
        statusCode: 409,
        details: {
          activeSubscriptions,
          reason: `${activeSubscriptions} active subscriptions are using this resource`,
        },
      };
    }

    // 3. 软删除:更新状态为DEPRECATED
    const deletedResource = await prisma.resource.update({
      where: { id },
      data: {
        status: ResourceStatus.DEPRECATED,
      },
      select: {
        id: true,
        type: true,
        name: true,
        status: true,
        updatedAt: true,
      },
    });

    return deletedResource;
  }

  /**
   * 更新资源状态
   */
  async updateResourceStatus(id: string, data: UpdateResourceStatusInput) {
    // 1. 查询资源当前状态
    const resource = await this.getResourceById(id);

    // 2. 检查新状态是否与当前状态相同
    if (resource.status === data.status) {
      throw {
        code: 'STATUS_UNCHANGED',
        message: `Resource is already in ${data.status} status`,
        statusCode: 400,
      };
    }

    // 3. 状态转换规则检查(资源只有2种状态,都可以互相转换)
    // ACTIVE <-> DEPRECATED 都是允许的

    // 4. 特殊检查:如果设为DEPRECATED,检查活跃订阅数量
    let warnings: string[] = [];
    if (data.status === 'DEPRECATED') {
      const activeSubscriptions = await prisma.subscriptionResource.count({
        where: {
          resourceId: id,
          removedAt: null,
        },
      });

      if (activeSubscriptions > 0) {
        warnings.push(`This resource has ${activeSubscriptions} active subscriptions, status change may affect users`);
      }
    }

    // 5. 更新状态
    const updatedResource = await prisma.resource.update({
      where: { id },
      data: {
        status: data.status as ResourceStatus,
      },
      select: {
        id: true,
        type: true,
        name: true,
        status: true,
        updatedAt: true,
      },
    });

    return {
      ...updatedResource,
      previousStatus: resource.status,
      ...(warnings.length > 0 && { warnings }),
    };
  }
}

// 导出单例
export const resourcesService = new ResourcesService();
