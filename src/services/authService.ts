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
      const response = await fetch(`${this.baseURL}/api/auth/public-key`, {
        headers: {
          'X-API-Key': this.internalApiKey,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get public key: ${response.status}`);
      }

      const data: PublicKeyResponse = await response.json();

      this.publicKey = data.publicKey;
      // 设置1小时后过期，提前刷新
      this.keyExpiresAt = Date.now() + 3600000;

      logger.info('Auth service public key refreshed');
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
}

export const authServiceClient = new AuthServiceClient();
