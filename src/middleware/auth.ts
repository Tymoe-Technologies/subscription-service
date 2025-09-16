import { Request, Response, NextFunction } from 'express';
import { service } from '../config/config.js';

// 验证内部API密钥
export function validateInternalApiKey(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');

  if (!apiKey) {
    res.status(401).json({
      error: 'unauthorized',
      message: '缺少API密钥',
    });
    return;
  }

  if (apiKey !== service.security.internalApiKey) {
    res.status(401).json({
      error: 'unauthorized',
      message: 'API密钥无效',
    });
    return;
  }

  next();
}

// 可选的API密钥验证（用于公开端点）
export function optionalApiKey(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');

  if (apiKey) {
    if (apiKey !== service.security.internalApiKey) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'API密钥无效',
      });
      return;
    }
    // 设置验证标记
    (req as any).isAuthenticated = true;
  }

  next();
}