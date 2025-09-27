import { Request, Response, NextFunction } from 'express';
import { auditService } from '../services/auditService.js';
import { logger } from '../utils/logger.js';

// 审计中间件 - 记录管理员操作
export async function auditMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    // 检查是否有管理员权限标记
    const isAdmin = req.headers['x-admin-access'] === 'true';
    const userId = req.headers['user-id'] as string;

    if (!isAdmin) {
      res.status(403).json({
        error: 'forbidden',
        message: 'Admin access required'
      });
      return;
    }

    if (!userId) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'User ID header required for admin operations'
      });
      return;
    }

    // 记录管理员操作开始
    await auditService.log({
      entityType: 'SUBSCRIPTION',
      entityId: req.params.intentId || req.params.organizationId || 'system',
      action: 'UPDATE',
      actorType: 'ADMIN',
      actorId: userId,
      metadata: {
        adminOperation: true,
        endpoint: req.originalUrl,
        method: req.method,
        ip: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString()
      }
    });

    next();
  } catch (error) {
    logger.error('Audit middleware error', {
      error: error instanceof Error ? error.message : String(error),
      url: req.originalUrl,
      method: req.method
    });

    res.status(500).json({
      error: 'server_error',
      message: 'Failed to process audit requirements'
    });
  }
}