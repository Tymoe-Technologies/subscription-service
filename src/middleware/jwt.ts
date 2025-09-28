import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authServiceClient } from '../services/authService.js';
import { logger } from '../utils/logger.js';
import { AuthenticatedRequest } from '../types/index.js';

export async function validateUserJWT(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      logger.debug('JWT validation failed: no token provided');
      res.status(401).json({
        error: 'unauthorized',
        message: 'Need to login to access',
      });
      return;
    }

    logger.debug('JWT validation starting', {
      tokenLength: token.length,
      tokenPrefix: token.substring(0, 20) + '...'
    });

    // 获取auth-service的公钥
    const publicKey = await authServiceClient.getPublicKey();

    logger.debug('Public key retrieved', {
      keyType: publicKey.includes('BEGIN CERTIFICATE') ? 'certificate' : 'public_key',
      keyLength: publicKey.length
    });

    // 解码JWT header来检查算法和kid
    const tokenParts = token.split('.');
    if (tokenParts.length !== 3) {
      logger.error('JWT validation failed: invalid token format', {
        parts: tokenParts.length
      });
      res.status(401).json({
        error: 'invalid_token',
        message: 'JWT token format is invalid',
      });
      return;
    }

    try {
      const header = JSON.parse(Buffer.from(tokenParts[0]!, 'base64').toString());
      logger.debug('JWT header decoded', { header });
    } catch (headerError) {
      logger.error('Failed to decode JWT header', { headerError });
    }

    // 验证JWT token
    logger.debug('Starting JWT verification with RS256', {
      publicKeyLength: publicKey.length,
      publicKeyStart: publicKey.substring(0, 50) + '...',
      tokenLength: token.length,
      tokenStart: token.substring(0, 50) + '...'
    });
    
    const payload = jwt.verify(token, publicKey, {
      algorithms: ['RS256'],
      clockTolerance: 30,  // 30秒时钟容错，与auth-service保持一致
    }) as { sub?: string; email?: string; exp?: number; [key: string]: unknown };

    logger.debug('JWT verification successful, payload received', {
      sub: payload.sub,
      hasEmail: !!payload.email,
      exp: payload.exp,
      payloadKeys: Object.keys(payload)
    });

    if (!payload.sub) {
      logger.error('JWT payload missing sub field', { payload });
      res.status(401).json({
        error: 'invalid_token',
        message: 'JWT token is invalid',
      });
      return;
    }

    (req as AuthenticatedRequest).user = {
      id: payload.sub,
      email: '', // subscription-service不存储邮箱，由auth-service管理
      iat: typeof payload.iat === 'number' ? payload.iat : 0,
      exp: typeof payload.exp === 'number' ? payload.exp : 0,
      organizationId: undefined,
      organizationName: undefined,
    };

    logger.info('JWT validation successful', {
      userId: payload.sub,
      iat: payload.iat,
      exp: payload.exp
    });

    next();
  } catch (error) {
    logger.error('JWT verification failed with detailed error', {
      error: error instanceof Error ? error.message : String(error),
      errorName: error && typeof error === 'object' && 'name' in error ? error.name : 'unknown',
      errorStack: error instanceof Error ? error.stack : undefined,
      token: req.headers.authorization ? 'present' : 'missing',
      tokenLength: req.headers.authorization?.replace('Bearer ', '').length,
      publicKeyLength: 'unknown', // 我们在catch块中无法访问publicKey
      fullError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
    });

    if (error && typeof error === 'object' && 'name' in error && error.name === 'TokenExpiredError') {
      res.status(401).json({
        error: 'token_expired',
        message: 'JWT token expired',
      });
      return;
    }

    if (error && typeof error === 'object' && 'name' in error && error.name === 'JsonWebTokenError') {
      res.status(401).json({
        error: 'invalid_token',
        message: 'JWT token is invalid',
      });
      return;
    }

    res.status(500).json({
      error: 'token_verification_failed',
      message: 'JWT verification failed',
    });
  }
}
