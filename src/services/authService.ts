import { service } from '../config/config.js';
import { logger } from '../utils/logger.js';
import crypto from 'crypto';

interface PublicKeyResponse {
  publicKey: string;
  kid: string;
  expiresAt: string;
}

interface OrganizationAccessResponse {
  hasAccess: boolean;
  role?: string;
}

interface UserOrganizationsResponse {
  organizations: string[];
}

class AuthServiceClient {
  private baseURL: string;
  private publicKey: string | null = null;
  private keyExpiresAt: number = 0;
  private internalApiKey: string;

  constructor() {
    this.baseURL = service.externalServices.authService;
    this.internalApiKey = service.security.internalApiKey;
  }

  async getPublicKey(): Promise<string> {
    // 缓存公钥，定期刷新
    if (this.publicKey && Date.now() < this.keyExpiresAt) {
      logger.debug('Using cached public key');
      return this.publicKey;
    }

    logger.info('Fetching public key from JWKS endpoint');

    try {
      // 从JWKS端点获取公钥
      const response = await fetch('https://tymoe.com/jwks.json');

      if (!response.ok) {
        throw new Error(`Failed to fetch JWKS: ${response.status}`);
      }

      const jwks = await response.json();
      logger.debug('JWKS response received', {
        keysCount: jwks.keys?.length || 0,
        firstKeyKid: jwks.keys?.[0]?.kid
      });

      if (!jwks.keys || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
        throw new Error('Invalid JWKS format or no keys found');
      }

      // 取第一个key，或者可以根据kid选择特定key
      const key = jwks.keys[0];
      logger.debug('Selected JWKS key', {
        kid: key.kid,
        alg: key.alg,
        kty: key.kty,
        use: key.use,
        hasNParam: !!key.n,
        hasEParam: !!key.e
      });

      // 支持RSA公钥参数格式 (n, e)
      if (!key.n || !key.e || key.kty !== 'RSA') {
        throw new Error('Invalid RSA key format in JWKS - missing n, e parameters or not RSA key');
      }

      // 从RSA参数构造公钥 (PEM格式)
      const publicKey = this.rsaParamsToPem(key.n, key.e);

      this.publicKey = publicKey;
      this.keyExpiresAt = Date.now() + 3600000; // 缓存1小时

      logger.info('Public key loaded from JWKS', {
        kid: key.kid,
        alg: key.alg,
        nParamLength: key.n.length,
        eParamLength: key.e.length,
        publicKeyLength: publicKey.length
      });

      return this.publicKey;
    } catch (error) {
      logger.error('Failed to get public key from JWKS', {
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined
      });

      // 直接抛出错误，不使用降级方案
      throw new Error(`Unable to fetch valid public key from JWKS: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 将RSA公钥参数 (n, e) 转换为PEM格式
   * @param n - RSA模数 (base64url编码)
   * @param e - RSA指数 (base64url编码) 
   * @returns PEM格式的公钥字符串
   */
  private rsaParamsToPem(n: string, e: string): string {
    try {
      // 使用Node.js crypto模块进行转换（更可靠）

      // 使用Node.js crypto模块创建RSA公钥
      const keyObject = crypto.createPublicKey({
        key: {
          kty: 'RSA',
          n: n, // 直接使用base64url字符串
          e: e  // 直接使用base64url字符串
        },
        format: 'jwk'
      });

      // 导出为PEM格式
      const pemKey = keyObject.export({
        type: 'spki',
        format: 'pem'
      });
      
      // 确保返回字符串类型
      return typeof pemKey === 'string' ? pemKey : pemKey.toString();
    } catch (error) {
      logger.error('Failed to convert RSA params to PEM using crypto module', {
        error: error instanceof Error ? error.message : String(error),
        nLength: n.length,
        eLength: e.length
      });
      throw new Error(`RSA to PEM conversion failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async checkUserOrganizationAccess(userId: string, organizationId: string): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.baseURL}/api/organizations/${organizationId}/access-check`,
        {
          headers: {
            'X-User-ID': userId,
            'X-API-Key': this.internalApiKey,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        if (response.status === 403 || response.status === 404) {
          return false;
        }
        throw new Error(`Failed to check organization access: ${response.status}`);
      }

      const data: OrganizationAccessResponse = await response.json();
      return data.hasAccess;
    } catch (error) {
      logger.error('Failed to check organization access', {
        userId,
        organizationId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  async getUserOrganizations(userId: string): Promise<string[]> {
    try {
      const response = await fetch(
        `${this.baseURL}/api/users/${userId}/organizations`,
        {
          headers: {
            'X-API-Key': this.internalApiKey,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to get user organizations: ${response.status}`);
      }

      const data: UserOrganizationsResponse = await response.json();
      return data.organizations;
    } catch (error) {
      logger.error('Failed to get user organizations', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}

export const authServiceClient = new AuthServiceClient();
