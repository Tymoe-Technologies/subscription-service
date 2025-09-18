// 微服务权限和限制配置

export interface MicroserviceLimit {
  // 每月调用次数限制 (0 = 无限制)
  monthlyRequests?: number;
  // 每天调用次数限制 (0 = 无限制)
  dailyRequests?: number;
  // 每小时调用次数限制 (0 = 无限制)
  hourlyRequests?: number;
  // 并发请求数限制 (0 = 无限制)
  concurrentRequests?: number;
  // 是否可以访问该微服务
  enabled: boolean;
}

export interface MicroserviceConfig {
  name: string;
  description: string;
  endpoint: string;
  limits: {
    trial: MicroserviceLimit;
    basic: MicroserviceLimit;
    standard: MicroserviceLimit;
    advanced: MicroserviceLimit;
    pro: MicroserviceLimit;
  };
}

// 微服务配置定义
export const microservices: Record<string, MicroserviceConfig> = {
  // 认证服务
  auth_service: {
    name: '认证服务',
    description: '用户认证和权限管理',
    endpoint: 'https://tymoe.com/api/auth-service',
    limits: {
      trial: { enabled: true, dailyRequests: 1000, hourlyRequests: 100 },
      basic: { enabled: true, dailyRequests: 5000, hourlyRequests: 500 },
      standard: { enabled: true, dailyRequests: 10000, hourlyRequests: 1000 },
      advanced: { enabled: true, dailyRequests: 50000, hourlyRequests: 5000 },
      pro: { enabled: true, monthlyRequests: 0, dailyRequests: 0, hourlyRequests: 0 }, // 无限制
    },
  },

  // 通知服务
  notification_service: {
    name: '通知服务',
    description: '邮件、短信、推送通知',
    endpoint: 'https://api.tymoe.com/notification-service',
    limits: {
      trial: { enabled: true, dailyRequests: 50, hourlyRequests: 10 },
      basic: { enabled: true, dailyRequests: 500, hourlyRequests: 50 },
      standard: { enabled: true, dailyRequests: 2000, hourlyRequests: 200 },
      advanced: { enabled: true, dailyRequests: 10000, hourlyRequests: 1000 },
      pro: { enabled: true, monthlyRequests: 0, dailyRequests: 0, hourlyRequests: 0 },
    },
  },

  // 文件存储服务
  storage_service: {
    name: '文件存储服务',
    description: '图片、文档、视频存储',
    endpoint: 'https://api.tymoe.com/storage-service',
    limits: {
      trial: { enabled: true, dailyRequests: 100, hourlyRequests: 20 },
      basic: { enabled: true, dailyRequests: 1000, hourlyRequests: 100 },
      standard: { enabled: true, dailyRequests: 5000, hourlyRequests: 500 },
      advanced: { enabled: true, dailyRequests: 20000, hourlyRequests: 2000 },
      pro: { enabled: true, monthlyRequests: 0, dailyRequests: 0, hourlyRequests: 0 },
    },
  },

  // 分析服务
  analytics_service: {
    name: '数据分析服务',
    description: '业务数据分析和报表生成',
    endpoint: 'https://api.tymoe.com/analytics-service',
    limits: {
      trial: { enabled: false, dailyRequests: 0 },
      basic: { enabled: false, dailyRequests: 0 },
      standard: { enabled: true, dailyRequests: 100, hourlyRequests: 20 },
      advanced: { enabled: true, dailyRequests: 1000, hourlyRequests: 100 },
      pro: { enabled: true, monthlyRequests: 0, dailyRequests: 0, hourlyRequests: 0 },
    },
  },

  // AI智能服务
  ai_service: {
    name: 'AI智能服务',
    description: '智能推荐、自动化处理',
    endpoint: 'https://api.tymoe.com/ai-service',
    limits: {
      trial: { enabled: false, dailyRequests: 0 },
      basic: { enabled: false, dailyRequests: 0 },
      standard: { enabled: false, dailyRequests: 0 },
      advanced: { enabled: true, dailyRequests: 50, hourlyRequests: 10 },
      pro: { enabled: true, dailyRequests: 500, hourlyRequests: 100 },
    },
  },

  // 第三方集成服务
  integration_service: {
    name: '第三方集成服务',
    description: '外部API集成和数据同步',
    endpoint: 'https://api.tymoe.com/integration-service',
    limits: {
      trial: { enabled: false, dailyRequests: 0 },
      basic: { enabled: false, dailyRequests: 0 },
      standard: { enabled: false, dailyRequests: 0 },
      advanced: { enabled: false, dailyRequests: 0 },
      pro: { enabled: true, dailyRequests: 10000, hourlyRequests: 1000 },
    },
  },

  // 支付服务
  payment_service: {
    name: '支付服务',
    description: '在线支付处理',
    endpoint: 'https://api.tymoe.com/payment-service',
    limits: {
      trial: { enabled: true, dailyRequests: 10, hourlyRequests: 5 },
      basic: { enabled: true, dailyRequests: 100, hourlyRequests: 20 },
      standard: { enabled: true, dailyRequests: 500, hourlyRequests: 100 },
      advanced: { enabled: true, dailyRequests: 2000, hourlyRequests: 500 },
      pro: { enabled: true, monthlyRequests: 0, dailyRequests: 0, hourlyRequests: 0 },
    },
  },
};

// 获取用户的微服务权限
export function getMicroserviceAccess(tier: string, serviceKey: string): MicroserviceLimit | null {
  const service = microservices[serviceKey];
  if (!service) {
    return null;
  }

  const tierKey = tier as keyof MicroserviceConfig['limits'];
  return service.limits[tierKey] || null;
}

// 检查用户是否可以访问微服务
export function canAccessMicroservice(tier: string, serviceKey: string): boolean {
  const access = getMicroserviceAccess(tier, serviceKey);
  return access?.enabled || false;
}

// 获取用户可访问的所有微服务
export function getAccessibleMicroservices(tier: string): string[] {
  return Object.keys(microservices).filter(serviceKey =>
    canAccessMicroservice(tier, serviceKey)
  );
}

// 获取使用限制信息
export function getUsageLimits(tier: string, serviceKey: string): Omit<MicroserviceLimit, 'enabled'> | null {
  const access = getMicroserviceAccess(tier, serviceKey);
  if (!access || !access.enabled) {
    return null;
  }

  return {
    monthlyRequests: access.monthlyRequests ?? 0,
    dailyRequests: access.dailyRequests ?? 0,
    hourlyRequests: access.hourlyRequests ?? 0,
    concurrentRequests: access.concurrentRequests ?? 0,
  };
}

export type SubscriptionTier = 'trial' | 'basic' | 'standard' | 'advanced' | 'pro';