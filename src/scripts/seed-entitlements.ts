import { prisma } from '../infra/prisma.js';
import { logger } from '../utils/logger.js';

async function seedEntitlements() {
  try {
    logger.info('开始初始化Level、Feature和Entitlement数据...');

    // 1. 创建Level数据
    const levels = [
      {
        key: 'trial',
        name: 'Trial',
        description: '免费试用版',
        sortOrder: 1,
      },
      {
        key: 'basic',
        name: 'Basic',
        description: '基础版',
        sortOrder: 2,
      },
      {
        key: 'standard',
        name: 'Standard',
        description: '标准版',
        sortOrder: 3,
      },
      {
        key: 'advanced',
        name: 'Advanced',
        description: '高级版',
        sortOrder: 4,
      },
      {
        key: 'pro',
        name: 'Pro',
        description: '专业版',
        sortOrder: 5,
      },
    ];

    for (const level of levels) {
      await prisma.level.upsert({
        where: { key: level.key },
        update: level,
        create: level,
      });
      logger.info(`Level创建/更新: ${level.key}`);
    }

    // 2. 创建Feature数据
    const features = [
      {
        key: 'team_size',
        name: 'Team Size',
        description: '团队成员数量限制',
        type: 'NUMBER',
        unit: 'users',
      },
      {
        key: 'ai_requests_per_month',
        name: 'AI Requests per Month',
        description: '每月AI请求数量',
        type: 'NUMBER',
        unit: 'requests',
      },
      {
        key: 'priority_support',
        name: 'Priority Support',
        description: '优先客服支持',
        type: 'BOOLEAN',
        unit: null,
      },
      {
        key: 'custom_integrations',
        name: 'Custom Integrations',
        description: '自定义集成功能',
        type: 'BOOLEAN',
        unit: null,
      },
      {
        key: 'advanced_analytics',
        name: 'Advanced Analytics',
        description: '高级数据分析',
        type: 'BOOLEAN',
        unit: null,
      },
      {
        key: 'data_export',
        name: 'Data Export',
        description: '数据导出功能',
        type: 'BOOLEAN',
        unit: null,
      },
      {
        key: 'api_rate_limit',
        name: 'API Rate Limit',
        description: 'API请求频率限制',
        type: 'NUMBER',
        unit: 'requests/hour',
      },
    ];

    for (const feature of features) {
      await prisma.feature.upsert({
        where: { key: feature.key },
        update: feature,
        create: feature,
      });
      logger.info(`Feature创建/更新: ${feature.key}`);
    }

    // 3. 创建Entitlement配置
    const entitlements = [
      // Trial level
      { levelKey: 'trial', featureKey: 'team_size', isEnabled: true, limit: 3 },
      { levelKey: 'trial', featureKey: 'ai_requests_per_month', isEnabled: true, limit: 100 },
      { levelKey: 'trial', featureKey: 'priority_support', isEnabled: false, limit: null },
      { levelKey: 'trial', featureKey: 'custom_integrations', isEnabled: false, limit: null },
      { levelKey: 'trial', featureKey: 'advanced_analytics', isEnabled: false, limit: null },
      { levelKey: 'trial', featureKey: 'data_export', isEnabled: false, limit: null },
      { levelKey: 'trial', featureKey: 'api_rate_limit', isEnabled: true, limit: 100 },

      // Basic level
      { levelKey: 'basic', featureKey: 'team_size', isEnabled: true, limit: 10 },
      { levelKey: 'basic', featureKey: 'ai_requests_per_month', isEnabled: true, limit: 1000 },
      { levelKey: 'basic', featureKey: 'priority_support', isEnabled: false, limit: null },
      { levelKey: 'basic', featureKey: 'custom_integrations', isEnabled: false, limit: null },
      { levelKey: 'basic', featureKey: 'advanced_analytics', isEnabled: true, limit: null },
      { levelKey: 'basic', featureKey: 'data_export', isEnabled: true, limit: null },
      { levelKey: 'basic', featureKey: 'api_rate_limit', isEnabled: true, limit: 500 },

      // Standard level
      { levelKey: 'standard', featureKey: 'team_size', isEnabled: true, limit: 25 },
      { levelKey: 'standard', featureKey: 'ai_requests_per_month', isEnabled: true, limit: 5000 },
      { levelKey: 'standard', featureKey: 'priority_support', isEnabled: true, limit: null },
      { levelKey: 'standard', featureKey: 'custom_integrations', isEnabled: true, limit: null },
      { levelKey: 'standard', featureKey: 'advanced_analytics', isEnabled: true, limit: null },
      { levelKey: 'standard', featureKey: 'data_export', isEnabled: true, limit: null },
      { levelKey: 'standard', featureKey: 'api_rate_limit', isEnabled: true, limit: 1000 },

      // Advanced level
      { levelKey: 'advanced', featureKey: 'team_size', isEnabled: true, limit: 100 },
      { levelKey: 'advanced', featureKey: 'ai_requests_per_month', isEnabled: true, limit: 20000 },
      { levelKey: 'advanced', featureKey: 'priority_support', isEnabled: true, limit: null },
      { levelKey: 'advanced', featureKey: 'custom_integrations', isEnabled: true, limit: null },
      { levelKey: 'advanced', featureKey: 'advanced_analytics', isEnabled: true, limit: null },
      { levelKey: 'advanced', featureKey: 'data_export', isEnabled: true, limit: null },
      { levelKey: 'advanced', featureKey: 'api_rate_limit', isEnabled: true, limit: 5000 },

      // Pro level
      { levelKey: 'pro', featureKey: 'team_size', isEnabled: true, limit: null }, // 无限制
      { levelKey: 'pro', featureKey: 'ai_requests_per_month', isEnabled: true, limit: null }, // 无限制
      { levelKey: 'pro', featureKey: 'priority_support', isEnabled: true, limit: null },
      { levelKey: 'pro', featureKey: 'custom_integrations', isEnabled: true, limit: null },
      { levelKey: 'pro', featureKey: 'advanced_analytics', isEnabled: true, limit: null },
      { levelKey: 'pro', featureKey: 'data_export', isEnabled: true, limit: null },
      { levelKey: 'pro', featureKey: 'api_rate_limit', isEnabled: true, limit: null }, // 无限制
    ];

    for (const entitlement of entitlements) {
      await prisma.entitlement.upsert({
        where: {
          levelKey_featureKey: {
            levelKey: entitlement.levelKey,
            featureKey: entitlement.featureKey,
          },
        },
        update: {
          isEnabled: entitlement.isEnabled,
          limit: entitlement.limit,
        },
        create: entitlement,
      });
      logger.info(`Entitlement创建/更新: ${entitlement.levelKey}.${entitlement.featureKey}`);
    }

    logger.info('Level、Feature和Entitlement数据初始化完成!');
  } catch (error) {
    logger.error('数据初始化失败:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// 如果直接运行此脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  seedEntitlements().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { seedEntitlements };