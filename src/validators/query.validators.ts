import { z } from 'zod';
import { InvoiceStatus } from '@prisma/client';

/**
 * Part 3: 查询API - Zod验证Schemas
 * 用于验证查询参数
 */

// ========================================
// 通用验证Schema
// ========================================

/**
 * 分页参数验证
 */
export const PaginationQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .default('1')
    .transform((val) => parseInt(val, 10))
    .refine((val) => val >= 1, { message: 'Page must be at least 1' }),
  pageSize: z
    .string()
    .optional()
    .default('20')
    .transform((val) => parseInt(val, 10))
    .refine((val) => val >= 1 && val <= 100, {
      message: 'Page size must be between 1 and 100',
    }),
});

/**
 * 时间范围验证
 */
export const DateRangeQuerySchema = z.object({
  from: z
    .string()
    .optional()
    .refine(
      (val) => !val || !isNaN(Date.parse(val)),
      { message: 'Invalid from date format' }
    ),
  to: z
    .string()
    .optional()
    .refine(
      (val) => !val || !isNaN(Date.parse(val)),
      { message: 'Invalid to date format' }
    ),
});

// ========================================
// API 2: 查询账单历史
// ========================================

export const GetInvoicesQuerySchema = PaginationQuerySchema.merge(DateRangeQuerySchema).extend({
  status: z.nativeEnum(InvoiceStatus).optional(),
});

export type GetInvoicesQuery = z.infer<typeof GetInvoicesQuerySchema>;

// ========================================
// API 3: 查询单个发票详情
// ========================================

export const InvoiceIdParamsSchema = z.object({
  invoiceId: z.string().uuid('Invalid invoice ID format'),
});

export type InvoiceIdParams = z.infer<typeof InvoiceIdParamsSchema>;

// ========================================
// API 4: 查询使用量明细
// ========================================

export const GetUsageQuerySchema = PaginationQuerySchema.merge(DateRangeQuerySchema).extend({
  usageType: z.string().optional(), // sms, api_call
  moduleId: z.string().uuid('Invalid module ID format').optional(),
  isFree: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      if (val === 'true') return true;
      if (val === 'false') return false;
      return undefined;
    }),
});

export type GetUsageQuery = z.infer<typeof GetUsageQuerySchema>;

// ========================================
// API 5: 查询使用量统计
// ========================================

export const GetUsageSummaryQuerySchema = DateRangeQuerySchema;

export type GetUsageSummaryQuery = z.infer<typeof GetUsageSummaryQuerySchema>;

// ========================================
// API 8: 查询订阅日志
// ========================================

export const GetLogsQuerySchema = PaginationQuerySchema.extend({
  action: z.string().optional(), // 操作类型筛选
});

export type GetLogsQuery = z.infer<typeof GetLogsQuerySchema>;

// ========================================
// 导出类型
// ========================================

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
export type DateRangeQuery = z.infer<typeof DateRangeQuerySchema>;
