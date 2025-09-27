import { service } from '../config/config.js';
import { logger } from '../utils/logger.js';

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
      return this.publicKey;
    }

    try {
      // 临时解决方案：使用静态公钥，避免启动时的JWKS问题
      const staticPublicKey = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtiQP1WDu08LvrtGReVib
Ik-ng2_s3q6ZlK0Q5wlaYt73wqus-FDLtgbUSmRwJZuBBkLHG-DPJkY85yxYaWRq
PYpqit-oQivLzJ0Ia4jbVm54UtSRl23WEI3yGP1bu5-0U7sX5sfsjxWSxvdSumHo
SzECzJSDiVweXv-FjZz3ZiQIVVAzj8qQDHMxnIFfEajfll3Z2AjZtp9nA4rdPqfL
MQ1OL0omxzfK1QffqkVqOzJ5eXeG3PzoRTTdFvpGe6ceK8eF1T0Ef9uaPwpduhjy
Au2fMpv34_zYWYzFlcU32_lJBUDIZ3PHm3WJnFruxEclsqgEHfP13wHbWFRrVg3I
LwIDAQAB
-----END PUBLIC KEY-----`;

      this.publicKey = staticPublicKey;
      this.keyExpiresAt = Date.now() + 3600000;

      logger.info('Auth service static public key loaded');
      return this.publicKey;
    } catch (error) {
      logger.error('Failed to get auth service public key', { error });
      throw error;
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
        error: error instanceof Error ? error instanceof Error ? error.message : String(error) : 'Unknown error',
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
