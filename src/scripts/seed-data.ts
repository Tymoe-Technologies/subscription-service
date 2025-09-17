#!/usr/bin/env tsx
/**
 * 数据种子脚本 - 初始化产品和价格数据
 * 用法: npm run prisma:seed
 */

import { prisma } from '../infra/prisma.js';
import { logger } from '../utils/logger.js';

async function main() {
  logger.info('🌱 开始种子数据初始化...');

  // 创建产品
  const products = [
    {
      key: 'ploml',
      name: 'Ploml Beauty Management',
      active: true,
    },
    {
      key: 'mopai',
      name: 'Mopai F&B Management',
      active: true,
    },
  ];

  for (const productData of products) {
    await prisma.product.upsert({
      where: { key: productData.key },
      update: productData,
      create: productData,
    });
    logger.info(`✅ 产品 ${productData.name} 已创建/更新`);
  }

  // 创建价格数据
  const priceData = [
    // Ploml 价格
    {
      productKey: 'ploml',
      tier: 'basic',
      billingCycle: 'monthly',
      amount: 2900,
      stripePriceId: 'price_ploml_basic_monthly',
    },
    {
      productKey: 'ploml',
      tier: 'basic',
      billingCycle: 'yearly',
      amount: 29000,
      stripePriceId: 'price_ploml_basic_yearly',
    },
    {
      productKey: 'ploml',
      tier: 'standard',
      billingCycle: 'monthly',
      amount: 7900,
      stripePriceId: 'price_ploml_standard_monthly',
    },
    {
      productKey: 'ploml',
      tier: 'standard',
      billingCycle: 'yearly',
      amount: 79000,
      stripePriceId: 'price_ploml_standard_yearly',
    },
    {
      productKey: 'ploml',
      tier: 'advanced',
      billingCycle: 'monthly',
      amount: 15900,
      stripePriceId: 'price_ploml_advanced_monthly',
    },
    {
      productKey: 'ploml',
      tier: 'advanced',
      billingCycle: 'yearly',
      amount: 159000,
      stripePriceId: 'price_ploml_advanced_yearly',
    },
    {
      productKey: 'ploml',
      tier: 'pro',
      billingCycle: 'monthly',
      amount: 29900,
      stripePriceId: 'price_ploml_pro_monthly',
    },
    {
      productKey: 'ploml',
      tier: 'pro',
      billingCycle: 'yearly',
      amount: 299000,
      stripePriceId: 'price_ploml_pro_yearly',
    },

    // Mopai 价格
    {
      productKey: 'mopai',
      tier: 'basic',
      billingCycle: 'monthly',
      amount: 2900,
      stripePriceId: 'price_mopai_basic_monthly',
    },
    {
      productKey: 'mopai',
      tier: 'basic',
      billingCycle: 'yearly',
      amount: 29000,
      stripePriceId: 'price_mopai_basic_yearly',
    },
    {
      productKey: 'mopai',
      tier: 'standard',
      billingCycle: 'monthly',
      amount: 7900,
      stripePriceId: 'price_mopai_standard_monthly',
    },
    {
      productKey: 'mopai',
      tier: 'standard',
      billingCycle: 'yearly',
      amount: 79000,
      stripePriceId: 'price_mopai_standard_yearly',
    },
    {
      productKey: 'mopai',
      tier: 'advanced',
      billingCycle: 'monthly',
      amount: 15900,
      stripePriceId: 'price_mopai_advanced_monthly',
    },
    {
      productKey: 'mopai',
      tier: 'advanced',
      billingCycle: 'yearly',
      amount: 159000,
      stripePriceId: 'price_mopai_advanced_yearly',
    },
    {
      productKey: 'mopai',
      tier: 'pro',
      billingCycle: 'monthly',
      amount: 29900,
      stripePriceId: 'price_mopai_pro_monthly',
    },
    {
      productKey: 'mopai',
      tier: 'pro',
      billingCycle: 'yearly',
      amount: 299000,
      stripePriceId: 'price_mopai_pro_yearly',
    },
  ];

  for (const price of priceData) {
    await prisma.price.upsert({
      where: {
        productKey_tier_billingCycle: {
          productKey: price.productKey,
          tier: price.tier,
          billingCycle: price.billingCycle,
        },
      },
      update: {
        amount: price.amount,
        stripePriceId: price.stripePriceId,
        active: true,
      },
      create: price,
    });
    logger.info(`✅ 价格 ${price.productKey} ${price.tier} ${price.billingCycle} 已创建/更新`);
  }

  logger.info('🎉 种子数据初始化完成！');
  logger.info('\n📊 数据摘要:');

  const productCount = await prisma.product.count();
  const priceCount = await prisma.price.count();

  logger.info(`- 产品: ${productCount}`);
  logger.info(`- 价格: ${priceCount}`);
}

void main()
  .catch(error => {
    logger.error('❌ 种子数据初始化失败:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
