import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../types/index.js';
import { microserviceUsageService } from '../services/microserviceUsage.service';
import { logger } from '../utils/logger';

export class MicroserviceUsageController {

  // POST /usage/record
  async recordUsage(req: Request, res: Response): Promise<void> {
    try {
      const { organizationId, subscriptionId, serviceKey, usagePeriod, periodType, requestCount } = req.body;

      if (!organizationId || !subscriptionId || !serviceKey || !usagePeriod || !periodType || requestCount === undefined) {
        res.status(400).json({
          success: false,
          error: { code: 'missing_fields', message: 'All fields are required' }
        });
        return;
      }

      if (!['hourly', 'daily', 'monthly'].includes(periodType)) {
        res.status(400).json({
          success: false,
          error: { code: 'invalid_period_type', message: 'periodType must be hourly, daily, or monthly' }
        });
        return;
      }

      const usage = await microserviceUsageService.recordUsage({
        organizationId,
        subscriptionId,
        serviceKey,
        usagePeriod,
        periodType,
        requestCount: parseInt(requestCount)
      });

      res.json({
        success: true,
        data: usage
      });
    } catch (error) {
      logger.error('Failed to record usage', {
        error: error instanceof Error ? error.message : String(error),
        body: req.body
      });

      res.status(500).json({
        success: false,
        error: { code: 'record_failed', message: 'Failed to record usage' }
      });
    }
  }

  // GET /usage/stats
  async getUsageStats(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const organizationId = req.user.organizationId || req.query.organizationId as string;
      const { serviceKey, periodType, startPeriod, endPeriod, limit } = req.query;

      if (!organizationId) {
        res.status(400).json({
          success: false,
          error: { code: 'missing_organization_id', message: 'Organization ID is required' }
        });
        return;
      }

      const stats = await microserviceUsageService.getUsageStats({
        organizationId,
        serviceKey: serviceKey as string,
        periodType: periodType as 'hourly' | 'daily' | 'monthly',
        startPeriod: startPeriod as string,
        endPeriod: endPeriod as string,
        ...(limit && { limit: parseInt(limit as string) })
      });

      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      logger.error('Failed to get usage stats', {
        error: error instanceof Error ? error.message : String(error),
        organizationId: req.user.organizationId,
        query: req.query
      });

      res.status(500).json({
        success: false,
        error: { code: 'stats_failed', message: 'Failed to get usage stats' }
      });
    }
  }

  // GET /usage/by-service
  async getUsageByService(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const organizationId = req.user.organizationId || req.query.organizationId as string;
      const { periodType, startPeriod, endPeriod } = req.query;

      if (!organizationId) {
        res.status(400).json({
          success: false,
          error: { code: 'missing_organization_id', message: 'Organization ID is required' }
        });
        return;
      }

      if (!periodType) {
        res.status(400).json({
          success: false,
          error: { code: 'missing_period_type', message: 'periodType is required' }
        });
        return;
      }

      const usageByService = await microserviceUsageService.getUsageByService(
        organizationId,
        periodType as string,
        startPeriod as string,
        endPeriod as string
      );

      res.json({
        success: true,
        data: usageByService
      });
    } catch (error) {
      logger.error('Failed to get usage by service', {
        error: error instanceof Error ? error.message : String(error),
        organizationId: req.user.organizationId,
        query: req.query
      });

      res.status(500).json({
        success: false,
        error: { code: 'service_usage_failed', message: 'Failed to get usage by service' }
      });
    }
  }

  // GET /usage/trends
  async getUsageTrends(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const organizationId = req.user.organizationId || req.query.organizationId as string;
      const { serviceKey, periodType, limit } = req.query;

      if (!organizationId) {
        res.status(400).json({
          success: false,
          error: { code: 'missing_organization_id', message: 'Organization ID is required' }
        });
        return;
      }

      if (!serviceKey || !periodType) {
        res.status(400).json({
          success: false,
          error: { code: 'missing_fields', message: 'serviceKey and periodType are required' }
        });
        return;
      }

      const trends = await microserviceUsageService.getUsageTrends(
        organizationId,
        serviceKey as string,
        periodType as string,
        limit ? parseInt(limit as string) : undefined
      );

      res.json({
        success: true,
        data: trends
      });
    } catch (error) {
      logger.error('Failed to get usage trends', {
        error: error instanceof Error ? error.message : String(error),
        organizationId: req.user.organizationId,
        query: req.query
      });

      res.status(500).json({
        success: false,
        error: { code: 'trends_failed', message: 'Failed to get usage trends' }
      });
    }
  }

  // GET /usage/current/:serviceKey
  async getCurrentUsage(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const organizationId = req.user.organizationId || req.query.organizationId as string;
      const { serviceKey } = req.params;
      const { periodType } = req.query;

      if (!organizationId) {
        res.status(400).json({
          success: false,
          error: { code: 'missing_organization_id', message: 'Organization ID is required' }
        });
        return;
      }

      if (!serviceKey || !periodType) {
        res.status(400).json({
          success: false,
          error: { code: 'missing_fields', message: 'serviceKey and periodType are required' }
        });
        return;
      }

      const currentUsage = await microserviceUsageService.getCurrentPeriodUsage(
        organizationId,
        serviceKey,
        periodType as string
      );

      res.json({
        success: true,
        data: currentUsage
      });
    } catch (error) {
      logger.error('Failed to get current usage', {
        error: error instanceof Error ? error.message : String(error),
        organizationId: req.user.organizationId,
        serviceKey: req.params.serviceKey
      });

      res.status(500).json({
        success: false,
        error: { code: 'current_usage_failed', message: 'Failed to get current usage' }
      });
    }
  }
}

export const microserviceUsageController = new MicroserviceUsageController();