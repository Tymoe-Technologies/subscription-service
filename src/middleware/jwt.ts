import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authServiceClient } from '../services/authService.js';
import { logger } from '../utils/logger.js';

export interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    email: string;
    iat: number;
    exp: number;
  };
}

export async function validateUserJWT(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      res.status(401).json({
        error: 'unauthorized',
        message: '需要登录访问',
      });
      return;
    }

    // 获取auth-service的公钥
    const publicKey = await authServiceClient.getPublicKey();

    // 验证JWT token
    const payload = jwt.verify(token, publicKey, {
      algorithms: ['RS256'],
    }) as any;

    if (!payload.sub || !payload.email) {
      res.status(401).json({
        error: 'invalid_token',
        message: 'JWT token格式无效',
      });
      return;
    }

    (req as AuthenticatedRequest).user = {
      id: payload.sub,
      email: payload.email,
      iat: payload.iat,
      exp: payload.exp,
    };

    logger.debug('JWT验证成功', {
      userId: payload.sub,
      email: payload.email,
    });

    next();
  } catch (error) {
    logger.warn('JWT验证失败', {
      error: error instanceof Error ? error.message : 'Unknown error',
      token: req.headers.authorization ? 'present' : 'missing',
    });

    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({
        error: 'token_expired',
        message: 'JWT token已过期',
      });
      return;
    }

    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({
        error: 'invalid_token',
        message: 'JWT token无效',
      });
      return;
    }

    res.status(500).json({
      error: 'token_verification_failed',
      message: 'JWT验证失败',
    });
  }
}