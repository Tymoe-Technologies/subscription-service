// Express 类型扩展
// 扩展 Express.Request 接口，添加认证后的用户信息

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;               // JWT 的 sub 字段 (userId 或 accountId)
        userId?: string;          // 兼容旧代码，与 id 同义
        email: string;            // 用户邮箱
        iat: number;              // JWT issued at
        exp: number;              // JWT expires at
        organizationId?: string;  // 当前选择的组织ID
        organizationIds?: string[]; // 用户所属的所有组织ID列表
        organizationName?: string; // 当前选择的组织名称
        userType?: 'USER' | 'ACCOUNT'; // 'USER' 或 'ACCOUNT'
        accountType?: 'MANAGER' | 'STAFF'; // ACCOUNT 类型的子类型
        jti?: string;             // JWT ID (用于黑名单检查)
        organizations?: Array<{   // 用户所属的所有组织
          id: string;
          name: string;
          orgName?: string;
          orgType?: 'MAIN' | 'BRANCH' | 'FRANCHISE';
          parentOrgId?: string;
          role?: string;
          status?: string;
        }>;
      };
    }
  }
}

export {};
