import { Request, Response, NextFunction } from 'express';
import { service } from '../config/config.js';
import * as jwt from 'jsonwebtoken';
import { JWTPayload, AuthenticatedRequest } from '../types/index.js';

const jwksClient = require('jwks-rsa');

// Export the AuthenticatedRequest type for use in controllers
export { AuthenticatedRequest };

const client = jwksClient({
  jwksUri: 'https://tymoe.com/jwks.json',
  requestHeaders: {},
  timeout: 30000,
});

function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) {
  client.getSigningKey(header.kid, (err: any, key: any) => {
    const signingKey = key?.getPublicKey();
    callback(err, signingKey);
  });
}

// 验证内部API密钥
export function validateInternalApiKey(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'] ?? req.headers['authorization']?.replace('Bearer ', '');

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
  const apiKey = req.headers['x-api-key'] ?? req.headers['authorization']?.replace('Bearer ', '');

  if (apiKey) {
    if (apiKey !== service.security.internalApiKey) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'API密钥无效',
      });
      return;
    }
    // 设置验证标记
    (req as Request & { isAuthenticated?: boolean }).isAuthenticated = true;
  }

  next();
}

// 验证API密钥（通用）
export const validateApiKey = validateInternalApiKey;

// JWT验证中间件
export function verifyJwtMiddleware(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    res.status(401).json({
      success: false,
      error: {
        code: 'unauthorized',
        message: 'Missing authorization token'
      }
    });
    return;
  }

  jwt.verify(token, getKey, {
    algorithms: ['RS256']
  }, (err, decoded) => {
    if (err) {
      res.status(401).json({
        success: false,
        error: {
          code: 'unauthorized',
          message: 'Invalid token'
        }
      });
      return;
    }

    const payload = decoded as JWTPayload;

    // 从JWT payload解析userId和organizationId
    const userId = payload.sub;
    let organizationId: string;
    let organizationName: string;

    if (!payload.organizations || payload.organizations.length === 0) {
      res.status(401).json({
        success: false,
        error: {
          code: 'unauthorized',
          message: 'No organization found in token'
        }
      });
      return;
    }

    // 取第一个组织作为当前组织
    const firstOrg = payload.organizations[0];
    if (!firstOrg) {
      res.status(401).json({
        success: false,
        error: {
          code: 'unauthorized',
          message: 'Invalid organization data in token'
        }
      });
      return;
    }

    organizationId = firstOrg.id;
    organizationName = firstOrg.name;

    (req as AuthenticatedRequest).user = {
      userId,
      organizationId,
      organizationName
    };

    next();
  });
}
