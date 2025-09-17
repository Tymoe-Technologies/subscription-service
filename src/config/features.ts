// 代码级别的功能权限配置

export interface FeatureConfig {
  key: string;
  name: string;
  description: string;
  tiers: {
    trial: boolean;
    basic: boolean;
    standard: boolean;
    advanced: boolean;
    pro: boolean;
  };
}

// Ploml (美业) 功能配置
export const plomlFeatures: Record<string, FeatureConfig> = {
  // 基础功能
  appointment_booking: {
    key: 'appointment_booking',
    name: '预约管理',
    description: '基础预约调度和管理',
    tiers: {
      trial: true,
      basic: true,
      standard: true,
      advanced: true,
      pro: true,
    },
  },

  customer_management: {
    key: 'customer_management',
    name: '客户管理',
    description: '客户档案和历史记录',
    tiers: {
      trial: true,
      basic: true,
      standard: true,
      advanced: true,
      pro: true,
    },
  },

  service_catalog: {
    key: 'service_catalog',
    name: '服务目录',
    description: '美业服务项目管理',
    tiers: {
      trial: true,
      basic: true,
      standard: true,
      advanced: true,
      pro: true,
    },
  },

  // 高级功能
  staff_scheduling: {
    key: 'staff_scheduling',
    name: '员工排班',
    description: '员工工作时间和排班管理',
    tiers: {
      trial: false,
      basic: false,
      standard: true,
      advanced: true,
      pro: true,
    },
  },

  inventory_management: {
    key: 'inventory_management',
    name: '库存管理',
    description: '产品库存跟踪和管理',
    tiers: {
      trial: false,
      basic: false,
      standard: false,
      advanced: true,
      pro: true,
    },
  },

  analytics_reports: {
    key: 'analytics_reports',
    name: '数据分析',
    description: '业务数据分析和报表',
    tiers: {
      trial: false,
      basic: false,
      standard: false,
      advanced: true,
      pro: true,
    },
  },

  // 专业功能
  multi_location: {
    key: 'multi_location',
    name: '多店管理',
    description: '管理多个营业地点',
    tiers: {
      trial: false,
      basic: false,
      standard: false,
      advanced: false,
      pro: true,
    },
  },

  api_access: {
    key: 'api_access',
    name: 'API访问',
    description: '第三方系统集成API',
    tiers: {
      trial: false,
      basic: false,
      standard: false,
      advanced: false,
      pro: true,
    },
  },

  custom_branding: {
    key: 'custom_branding',
    name: '品牌定制',
    description: '自定义品牌和界面',
    tiers: {
      trial: false,
      basic: false,
      standard: false,
      advanced: false,
      pro: true,
    },
  },
};

// Mopai (餐饮) 功能配置
export const mopaiFeatures: Record<string, FeatureConfig> = {
  // 基础功能
  table_management: {
    key: 'table_management',
    name: '桌台管理',
    description: '餐桌状态和预订管理',
    tiers: {
      trial: true,
      basic: true,
      standard: true,
      advanced: true,
      pro: true,
    },
  },

  menu_management: {
    key: 'menu_management',
    name: '菜单管理',
    description: '菜品和价格管理',
    tiers: {
      trial: true,
      basic: true,
      standard: true,
      advanced: true,
      pro: true,
    },
  },

  order_taking: {
    key: 'order_taking',
    name: '点餐下单',
    description: '基础点餐和订单处理',
    tiers: {
      trial: true,
      basic: true,
      standard: true,
      advanced: true,
      pro: true,
    },
  },

  // 高级功能
  kitchen_display: {
    key: 'kitchen_display',
    name: '厨房显示',
    description: '厨房订单显示系统',
    tiers: {
      trial: false,
      basic: false,
      standard: true,
      advanced: true,
      pro: true,
    },
  },

  inventory_tracking: {
    key: 'inventory_tracking',
    name: '库存跟踪',
    description: '食材库存管理',
    tiers: {
      trial: false,
      basic: false,
      standard: false,
      advanced: true,
      pro: true,
    },
  },

  staff_management: {
    key: 'staff_management',
    name: '员工管理',
    description: '员工排班和权限管理',
    tiers: {
      trial: false,
      basic: false,
      standard: false,
      advanced: true,
      pro: true,
    },
  },

  // 专业功能
  multi_restaurant: {
    key: 'multi_restaurant',
    name: '多店管理',
    description: '管理多个餐厅位置',
    tiers: {
      trial: false,
      basic: false,
      standard: false,
      advanced: false,
      pro: true,
    },
  },

  delivery_integration: {
    key: 'delivery_integration',
    name: '外卖集成',
    description: '第三方外卖平台集成',
    tiers: {
      trial: false,
      basic: false,
      standard: false,
      advanced: false,
      pro: true,
    },
  },

  analytics_dashboard: {
    key: 'analytics_dashboard',
    name: '数据仪表板',
    description: '营业数据分析和报表',
    tiers: {
      trial: false,
      basic: false,
      standard: false,
      advanced: false,
      pro: true,
    },
  },
};

// 获取产品功能配置
export function getProductFeatures(productKey: string): Record<string, FeatureConfig> {
  switch (productKey) {
    case 'ploml':
      return plomlFeatures;
    case 'mopai':
      return mopaiFeatures;
    default:
      return {};
  }
}

// 检查用户是否有某个功能的权限
export function hasFeatureAccess(productKey: string, tier: string, featureKey: string): boolean {
  const features = getProductFeatures(productKey);
  const feature = features[featureKey];

  if (!feature) {
    return false;
  }

  const tierKey = tier as keyof FeatureConfig['tiers'];
  return feature?.tiers[tierKey] || false;
}

// 获取套餐包含的所有功能
export function getTierFeatures(productKey: string, tier: string): string[] {
  const features = getProductFeatures(productKey);
  const tierKey = tier as keyof FeatureConfig['tiers'];

  return Object.keys(features).filter(featureKey => features[featureKey]?.tiers[tierKey] ?? false);
}

// 订阅套餐定义
export const subscriptionTiers = {
  trial: {
    name: '试用版',
    description: '30天免费试用，体验基础功能',
    price: 0,
  },
  basic: {
    name: '基础版',
    description: '适合小型店铺的基础功能',
    monthlyPrice: 29,
    yearlyPrice: 290, // 约8.3折
  },
  standard: {
    name: '标准版',
    description: '适合中型店铺，包含高级排班功能',
    monthlyPrice: 79,
    yearlyPrice: 790, // 约8.3折
  },
  advanced: {
    name: '高级版',
    description: '适合大型店铺，包含库存和数据分析',
    monthlyPrice: 159,
    yearlyPrice: 1590, // 约8.3折
  },
  pro: {
    name: '专业版',
    description: '企业级功能，多店管理和API集成',
    monthlyPrice: 299,
    yearlyPrice: 2990, // 约8.3折
  },
} as const;

export type SubscriptionTier = keyof typeof subscriptionTiers;
