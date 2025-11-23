import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * JWKS 公钥缓存
 */
let cachedPublicKey: string | null = null;
let publicKeyExpiry: number = 0;

/**
 * JWK 格式的公钥接口
 */
interface JWK {
  kty: string;
  n: string;
  e: string;
  alg: string;
  kid: string;
  use?: string;
}

interface JWKSResponse {
  keys: JWK[];
}

/**
 * 将 JWK 格式转换为 PEM 格式的公钥
 * @param jwk - JWK 格式的公钥对象
 * @returns PEM 格式的公钥字符串
 */
function jwkToPem(jwk: JWK): string {
  try {
    // 创建公钥对象
    const publicKey = crypto.createPublicKey({
      key: {
        kty: 'RSA',
        n: jwk.n,
        e: jwk.e,
      },
      format: 'jwk'
    });

    // 导出为 PEM 格式
    return publicKey.export({
      type: 'spki',
      format: 'pem'
    }) as string;
  } catch (error) {
    logger.error('Convert JWK to PEM failed', { error, jwk });
    throw new Error('Failed to convert JWK to PEM');
  }
}

/**
 * 从 auth-service 获取 JWKS 公钥
 * 带缓存机制，默认缓存1小时
 */
export async function getPublicKey(): Promise<string> {
  // 检查缓存
  const now = Date.now();
  if (cachedPublicKey && publicKeyExpiry > now) {
    logger.debug('Using cached public key');
    return cachedPublicKey;
  }

  try {
    logger.info('Fetching JWKS public key from auth-service');

    const authServiceUrl = env.AUTH_SERVICE_URL || 'http://localhost:3000';
    const response = await fetch(`${authServiceUrl}/jwks.json`);

    if (!response.ok) {
      throw new Error(`Failed to fetch JWKS: ${response.status}`);
    }

    const jwks: JWKSResponse = await response.json();

    if (!jwks.keys || jwks.keys.length === 0) {
      throw new Error('No public keys in JWKS response');
    }

    // 使用第一个公钥
    const jwk = jwks.keys[0];
    if (!jwk) {
      throw new Error('Invalid JWKS response: first key is undefined');
    }
    const publicKey = jwkToPem(jwk);

    // 缓存公钥(1小时)
    cachedPublicKey = publicKey;
    publicKeyExpiry = now + 60 * 60 * 1000;  // 1小时后过期

    logger.info('JWKS public key fetched and cached successfully');

    return publicKey;
  } catch (error) {
    logger.error('Failed to fetch JWKS public key', { error });
    throw new Error('Failed to fetch public key from auth-service');
  }
}

/**
 * 检查 token 是否在黑名单中
 * @param jti - JWT ID
 * @returns true 表示在黑名单中(已被撤销)
 */
export async function checkBlacklist(jti: string): Promise<boolean> {
  try {
    const authServiceUrl = env.AUTH_SERVICE_URL || 'http://localhost:3000';
    const internalApiKey = env.INTERNAL_API_KEY;

    if (!internalApiKey) {
      logger.warn('INTERNAL_API_KEY not configured, skipping blacklist check');
      return false;  // 开发环境可以跳过
    }

    logger.debug('Checking token blacklist', { jti });

    const response = await fetch(
      `${authServiceUrl}/api/auth-service/v1/internal/token/check-blacklist`,
      {
        method: 'POST',
        headers: {
          'X-Internal-Service-Key': internalApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jti }),
      }
    );

    if (!response.ok) {
      logger.error('Failed to check blacklist', {
        status: response.status,
        jti
      });
      throw new Error('Failed to check token blacklist');
    }

    const result = await response.json();

    logger.debug('Blacklist check result', {
      jti,
      isBlacklisted: result.isBlacklisted
    });

    return result.isBlacklisted === true;
  } catch (error) {
    logger.error('Error checking token blacklist', { error, jti });
    // 安全起见，如果检查失败，可以选择拒绝请求
    // 但在开发环境可以允许通过
    if (env.NODE_ENV === 'production') {
      throw error;  // 生产环境严格检查
    }
    return false;  // 开发环境允许通过
  }
}

/**
 * 验证 JWT token
 * @param token - JWT token 字符串
 * @returns 解码后的 payload
 */
export async function verifyJWT(token: string): Promise<any> {
  try {
    // 1. 获取公钥
    const publicKey = await getPublicKey();

    // 2. 验证 JWT 签名
    const decoded = jwt.verify(token, publicKey, {
      algorithms: ['RS256'],  // 只允许 RS256 算法
    }) as any;

    logger.debug('JWT signature verified successfully', {
      sub: decoded.sub,
      userType: decoded.userType,
      jti: decoded.jti,
    });

    // 3. 检查黑名单
    const isBlacklisted = await checkBlacklist(decoded.jti);

    if (isBlacklisted) {
      throw new Error('Token has been revoked');
    }

    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Token expired');
    } else if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid token');
    } else {
      throw error;
    }
  }
}
