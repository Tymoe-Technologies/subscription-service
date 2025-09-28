import { Request, Response, NextFunction } from 'express';
import { service } from '../config/config.js';
import jwt from 'jsonwebtoken';
import { JWTPayload } from '../types/index.js';
import { AuthenticatedRequest } from '../types/index.js';
import crypto from 'crypto';

import jwksClient from 'jwks-rsa';

// The AuthenticatedRequest type is exported from types/index.ts

const client = jwksClient({
  jwksUri: 'https://tymoe.com/jwks.json',
  requestHeaders: {},
  timeout: 30000,
});

function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) {
  console.log('DEBUG: getKey called', {
    kid: header.kid,
    alg: header.alg,
    typ: header.typ
  });

  client.getSigningKey(header.kid!, (err: any, key: any) => {
    if (err) {
      console.log('DEBUG: getSigningKey error', {
        error: err.message,
        errorName: err.name,
        kid: header.kid!
      });

      // 如果找不到指定的kid，尝试获取第一个可用的key作为fallback
      if (err.name === 'SigningKeyNotFoundError') {
        console.log('DEBUG: Attempting fallback - fetching first available key');

        // 直接从JWKS端点获取keys
        fetch('https://tymoe.com/jwks.json')
          .then(response => response.json())
          .then(jwks => {
            if (jwks.keys && jwks.keys.length > 0) {
              const firstKey = jwks.keys[0];
              console.log('DEBUG: Using fallback key', {
                originalKid: header.kid!,
                fallbackKid: firstKey.kid,
                hasN: !!firstKey.n,
                hasE: !!firstKey.e
              });

              // 构造RSA公钥
              if (firstKey.n && firstKey.e) {
                // 使用crypto库将n和e转换为PEM格式
                const keyObject = crypto.createPublicKey({
                  key: {
                    kty: 'RSA',
                    n: firstKey.n,
                    e: firstKey.e
                  },
                  format: 'jwk'
                });
                const pemKey = keyObject.export({ type: 'spki', format: 'pem' }) as string;

                console.log('DEBUG: Generated PEM key from JWK', {
                  pemLength: pemKey.length,
                  pemPrefix: pemKey.substring(0, 50) + '...'
                });

                callback(null, pemKey as any);
              } else {
                callback(new Error('Invalid JWK format'), undefined);
              }
            } else {
              callback(new Error('No keys available in JWKS'), undefined);
            }
          })
          .catch(fetchErr => {
            console.log('DEBUG: Fallback JWKS fetch failed', { fetchErr });
            callback(fetchErr, undefined);
          });
        return;
      }

      // 如果不是SigningKeyNotFoundError，直接调用callback
      callback(err, undefined);
    } else {
      console.log('DEBUG: getSigningKey success', {
        hasKey: !!key,
        keyType: typeof key,
        kid: header.kid!
      });

      const signingKey = key?.getPublicKey();
      console.log('DEBUG: Extracted signing key', {
        hasSigningKey: !!signingKey,
        signingKeyLength: signingKey?.length,
        signingKeyType: typeof signingKey,
        signingKeyPrefix: signingKey?.substring(0, 50) + '...'
      });

      callback(err, signingKey);
    }
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

  console.log('DEBUG: JWT verification starting', {
    hasToken: !!token,
    tokenLength: token?.length,
    tokenPrefix: token?.substring(0, 20) + '...'
  });

  if (!token) {
    console.log('DEBUG: No token provided');
    res.status(401).json({
      success: false,
      error: {
        code: 'unauthorized',
        message: 'Missing authorization token'
      }
    });
    return;
  }

  // 解码JWT header来检查算法和kid
  const tokenParts = token.split('.');
  if (tokenParts.length !== 3) {
    console.log('DEBUG: Invalid token format', { parts: tokenParts.length });
    res.status(401).json({
      success: false,
      error: {
        code: 'unauthorized',
        message: 'Invalid token format'
      }
    });
    return;
  }

  try {
    const header = JSON.parse(Buffer.from(tokenParts[0]!, 'base64').toString());
    console.log('DEBUG: JWT header decoded', { header });
  } catch (headerError) {
    console.log('DEBUG: Failed to decode JWT header', { headerError });
  }

  console.log('DEBUG: About to call jwt.verify with getKey function');

  jwt.verify(token, getKey, {
    algorithms: ['RS256']
  }, (err, decoded) => {
    if (err) {
      console.log('DEBUG: JWT verification failed', {
        error: err.message,
        errorName: err.name,
        errorStack: err.stack
      });
      res.status(401).json({
        success: false,
        error: {
          code: 'unauthorized',
          message: 'Invalid token'
        }
      });
      return;
    }

    console.log('DEBUG: JWT verification successful', {
      decoded: typeof decoded === 'object' ? Object.keys(decoded || {}) : 'not object'
    });

    const payload = decoded as JWTPayload;

    // 从JWT payload解析userId和organizationId
    const userId = payload.sub;
    let organizationId: string;
    let organizationName: string;

    console.log('DEBUG: Payload analysis', {
      sub: payload.sub,
      hasOrganizations: !!payload.organizations,
      organizationsLength: payload.organizations?.length || 0,
      organizationId: payload.organizationId
    });

    // 支持两种格式：organizations数组格式 或 organizationId字段格式
    if (payload.organizations && payload.organizations.length > 0) {
      // 使用organizations数组格式
      const firstOrg = payload.organizations[0]!;
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
    } else if (payload.organizationId) {
      // 使用organizationId字段格式
      organizationId = payload.organizationId;
      organizationName = payload.organizationId; // 使用ID作为名称，或者可以留空
    } else {
      res.status(401).json({
        success: false,
        error: {
          code: 'unauthorized',
          message: 'No organization found in token'
        }
      });
      return;
    }

    (req as AuthenticatedRequest).user = {
      id: userId,
      email: payload.email || '',
      iat: payload.iat || 0,
      exp: payload.exp || 0,
      organizationId,
      organizationName
    };

    console.log('DEBUG: JWT verification completed successfully', {
      userId,
      organizationId,
      organizationName
    });

    next();
  });
}
