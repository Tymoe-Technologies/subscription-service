import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../types/index.js';
import { queryService } from '../services/query.service.js';
import type {
  GetInvoicesQuery,
  GetUsageQuery,
  GetUsageSummaryQuery,
  GetLogsQuery,
  InvoiceIdParams,
} from '../validators/query.validators.js';

/**
 * Part 3: 查询API - Controller层
 * 处理前端用户的查询请求
 */
export class QueryController {
  /**
   * API 1: 查询当前订阅详情
   * GET /queries/subscription
   */
  async getCurrentSubscription(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthenticatedRequest;
      const orgId = authReq.user.organizationId!;

      const result = await queryService.getCurrentSubscription(orgId);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * API 2: 查询账单历史
   * GET /queries/invoices
   */
  async getInvoices(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthenticatedRequest;
      const orgId = authReq.user.organizationId!;
      const query = req.query as unknown as GetInvoicesQuery;

      const result = await queryService.getInvoices(orgId, query);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * API 3: 查询单个发票详情
   * GET /queries/invoices/:invoiceId
   */
  async getInvoiceById(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthenticatedRequest;
      const orgId = authReq.user.organizationId!;
      const { invoiceId } = req.params as InvoiceIdParams;

      const result = await queryService.getInvoiceById(orgId, invoiceId);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * API 4: 查询使用量明细
   * GET /queries/usage
   */
  async getUsage(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthenticatedRequest;
      const orgId = authReq.user.organizationId!;
      const query = req.query as unknown as GetUsageQuery;

      const result = await queryService.getUsage(orgId, query);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * API 5: 查询使用量统计
   * GET /queries/usage/summary
   */
  async getUsageSummary(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthenticatedRequest;
      const orgId = authReq.user.organizationId!;
      const query = req.query as unknown as GetUsageSummaryQuery;

      const result = await queryService.getUsageSummary(orgId, query);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * API 6: 预览激活后费用
   * GET /queries/preview-activation
   */
  async previewActivation(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthenticatedRequest;
      const orgId = authReq.user.organizationId!;

      const result = await queryService.previewActivation(orgId);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * API 7: 查询可用配额
   * GET /queries/quotas
   */
  async getQuotas(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthenticatedRequest;
      const orgId = authReq.user.organizationId!;

      const result = await queryService.getQuotas(orgId);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * API 8: 查询订阅日志
   * GET /queries/logs
   */
  async getLogs(req: Request, res: Response): Promise<void> {
    try {
      const authReq = req as AuthenticatedRequest;
      const orgId = authReq.user.organizationId!;
      const query = req.query as unknown as GetLogsQuery;

      const result = await queryService.getLogs(orgId, query);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      this.handleError(res, error);
    }
  }

  /**
   * 统一错误处理
   */
  private handleError(res: Response, error: any): void {
    // 如果是业务异常(从Service层抛出的)
    if (error.code && error.statusCode) {
      res.status(error.statusCode).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details && { details: error.details }),
        },
      });
      return;
    }

    // Prisma错误处理
    if (error.code && error.code.startsWith('P')) {
      res.status(500).json({
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Database query error',
        },
      });
      return;
    }

    // 未知错误
    console.error('[QueryController] Unexpected error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error. Please try again later.',
      },
    });
  }
}

// 导出单例
export const queryController = new QueryController();
