/**
 * Stripe订阅创建测试脚本
 * 用于测试Stripe订阅创建并查看完整的响应日志
 */

import { stripeService } from './src/infra/stripe.js';
import { logger } from './src/utils/logger.js';

async function testStripeSubscription() {
  try {
    logger.info('🚀 开始测试Stripe订阅创建...\n');

    // 1. 创建测试客户
    logger.info('步骤 1: 创建Stripe测试客户...');
    const customer = await stripeService.createCustomer({
      name: 'Test Organization',
      email: 'test@example.com',
      organizationId: 'test-org-123',
      metadata: {
        environment: 'test',
        purpose: 'subscription-test',
      },
    });
    logger.info(`✅ 客户创建成功: ${customer.id}\n`);

    // 2. 创建测试订阅（Trial）
    logger.info('步骤 2: 创建Stripe测试订阅 (30天Trial)...');
    const subscription = await stripeService.createSubscription({
      customerId: customer.id,
      priceId: 'price_1SQfS1QxFRasl8cWugJZ6haE', // Standard Plan Price ID from .env
      trialPeriodDays: 30,
      metadata: {
        organizationId: 'test-org-123',
        planName: 'Standard Plan',
        environment: 'test',
      },
    });

    logger.info('\n✅ 订阅创建成功！');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('📋 订阅摘要信息:');
    logger.info(`   订阅ID: ${subscription.id}`);
    logger.info(`   客户ID: ${subscription.customer}`);
    logger.info(`   状态: ${subscription.status}`);
    logger.info(`   Trial结束时间: ${subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : 'N/A'}`);
    logger.info(`   当前周期开始: ${new Date(subscription.current_period_start * 1000).toISOString()}`);
    logger.info(`   当前周期结束: ${new Date(subscription.current_period_end * 1000).toISOString()}`);
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // 3. 获取订阅详情（验证）
    logger.info('步骤 3: 获取订阅详情验证...');
    const retrievedSubscription = await stripeService.getSubscription(subscription.id);
    if (retrievedSubscription) {
      logger.info('✅ 订阅验证成功\n');
    }

    logger.info('🎉 测试完成！请查看上方日志中的完整Stripe响应对象。');
    
  } catch (error: any) {
    logger.error('❌ 测试失败:', error.message);
    if (error.type === 'StripeInvalidRequestError') {
      logger.error('Stripe错误详情:', {
        message: error.message,
        param: error.param,
        code: error.code,
      });
    }
    throw error;
  }
}

// 执行测试
testStripeSubscription()
  .then(() => {
    logger.info('\n✅ 脚本执行完毕');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('\n❌ 脚本执行失败:', error);
    process.exit(1);
  });

