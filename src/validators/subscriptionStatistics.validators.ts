import { z } from 'zod';

/**
 * 订阅统计查询API的验证schemas
 */

// 统计查询参数验证
export const StatisticsQuerySchema = z
  .object({
    from: z
      .string()
      .datetime({ message: '起始时间必须是有效的ISO 8601格式' })
      .optional(),
    to: z
      .string()
      .datetime({ message: '结束时间必须是有效的ISO 8601格式' })
      .optional(),
  })
  .refine(
    (data) => {
      if (data.from && data.to) {
        return new Date(data.from) <= new Date(data.to);
      }
      return true;
    },
    {
      message: '起始时间必须早于或等于结束时间',
      path: ['from'],
    }
  );

export type StatisticsQuery = z.infer<typeof StatisticsQuerySchema>;

// 订阅列表查询参数验证
export const ListSubscriptionsQuerySchema = z
  .object({
    // 分页
    page: z
      .string()
      .transform((val) => parseInt(val, 10))
      .pipe(z.number().int().min(1, '页码必须>=1'))
      .optional()
      .default('1'),
    limit: z
      .string()
      .transform((val) => parseInt(val, 10))
      .pipe(z.number().int().min(1).max(100, '每页数量必须在1-100之间'))
      .optional()
      .default('20'),

    // 状态筛选
    status: z
      .enum(['TRIAL', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'CANCELLED'], {
        errorMap: () => ({
          message:
            '状态必须是: TRIAL, ACTIVE, EXPIRED, SUSPENDED, CANCELLED之一',
        }),
      })
      .optional(),

    // ID搜索
    orgId: z.string().min(1, '组织ID不能为空').optional(),
    payerId: z.string().min(1, '付款人ID不能为空').optional(),

    // 支付方式筛选
    paymentProvider: z
      .enum(['stripe', 'paypal', 'none'], {
        errorMap: () => ({
          message: '支付提供商必须是: stripe, paypal, none之一',
        }),
      })
      .optional(),
    autoRenew: z
      .string()
      .transform((val) => val === 'true')
      .pipe(z.boolean())
      .optional(),

    // 时间范围筛选
    createdFrom: z
      .string()
      .datetime({ message: '创建起始时间必须是有效的ISO 8601格式' })
      .optional(),
    createdTo: z
      .string()
      .datetime({ message: '创建结束时间必须是有效的ISO 8601格式' })
      .optional(),
    renewsFrom: z
      .string()
      .datetime({ message: '续费起始时间必须是有效的ISO 8601格式' })
      .optional(),
    renewsTo: z
      .string()
      .datetime({ message: '续费结束时间必须是有效的ISO 8601格式' })
      .optional(),
    trialEndsFrom: z
      .string()
      .datetime({ message: '试用结束起始时间必须是有效的ISO 8601格式' })
      .optional(),
    trialEndsTo: z
      .string()
      .datetime({ message: '试用结束结束时间必须是有效的ISO 8601格式' })
      .optional(),

    // 价格范围筛选
    priceMin: z
      .string()
      .transform((val) => parseFloat(val))
      .pipe(z.number().nonnegative('最低价格必须>=0'))
      .optional(),
    priceMax: z
      .string()
      .transform((val) => parseFloat(val))
      .pipe(z.number().nonnegative('最高价格必须>=0'))
      .optional(),

    // 排序
    sortBy: z
      .enum(['createdAt', 'renewsAt', 'standardPrice', 'status', 'trialEndsAt'], {
        errorMap: () => ({
          message:
            '排序字段必须是: createdAt, renewsAt, standardPrice, status, trialEndsAt之一',
        }),
      })
      .optional()
      .default('createdAt'),
    order: z
      .enum(['asc', 'desc'], {
        errorMap: () => ({ message: '排序方向必须是: asc或desc' }),
      })
      .optional()
      .default('desc'),
  })
  .refine(
    (data) => {
      if (data.createdFrom && data.createdTo) {
        return new Date(data.createdFrom) <= new Date(data.createdTo);
      }
      return true;
    },
    {
      message: '创建起始时间必须早于或等于创建结束时间',
      path: ['createdFrom'],
    }
  )
  .refine(
    (data) => {
      if (data.renewsFrom && data.renewsTo) {
        return new Date(data.renewsFrom) <= new Date(data.renewsTo);
      }
      return true;
    },
    {
      message: '续费起始时间必须早于或等于续费结束时间',
      path: ['renewsFrom'],
    }
  )
  .refine(
    (data) => {
      if (data.trialEndsFrom && data.trialEndsTo) {
        return new Date(data.trialEndsFrom) <= new Date(data.trialEndsTo);
      }
      return true;
    },
    {
      message: '试用结束起始时间必须早于或等于试用结束结束时间',
      path: ['trialEndsFrom'],
    }
  )
  .refine(
    (data) => {
      if (data.priceMin !== undefined && data.priceMax !== undefined) {
        return data.priceMin <= data.priceMax;
      }
      return true;
    },
    {
      message: '最低价格必须小于或等于最高价格',
      path: ['priceMin'],
    }
  );

export type ListSubscriptionsQuery = z.infer<typeof ListSubscriptionsQuerySchema>;
