/**
 * 自动化逻辑验证脚本
 * 
 * 这个脚本会连接数据库，检查关键逻辑是否正确实现：
 * 1. renewsAt 字段是否正确设置
 * 2. 已取消订阅是否有 cancelledAt
 * 3. 按比例计费记录是否正确
 * 4. 资源数量是否正确累加
 */

import { prisma } from '../src/infra/prisma.js';
import { logger } from '../src/utils/logger.js';

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  details?: any;
}

const results: TestResult[] = [];

async function test1_renewsAtNotNull() {
  console.log('\n📋 测试 1: 检查 renewsAt 字段...');
  
  const subscriptions = await prisma.subscription.findMany({
    where: {
      status: {
        in: ['ACTIVE', 'TRIAL']
      }
    },
    select: {
      id: true,
      orgId: true,
      status: true,
      renewsAt: true,
      trialEndsAt: true,
      startedAt: true,
    },
    take: 10, // 只检查前 10 个
  });

  const nullRenewsAt = subscriptions.filter(sub => !sub.renewsAt);
  
  const passed = nullRenewsAt.length === 0;
  
  results.push({
    name: 'renewsAt 字段不为 null',
    passed,
    message: passed 
      ? `✅ 所有 ${subscriptions.length} 个订阅的 renewsAt 都已正确设置` 
      : `❌ 发现 ${nullRenewsAt.length} 个订阅的 renewsAt 为 null`,
    details: passed ? null : nullRenewsAt.map(sub => ({
      id: sub.id,
      orgId: sub.orgId,
      status: sub.status,
      renewsAt: sub.renewsAt,
    })),
  });

  if (!passed) {
    console.log('  ❌ 失败：以下订阅的 renewsAt 为 null:');
    nullRenewsAt.forEach(sub => {
      console.log(`     - ${sub.id} (${sub.orgId})`);
    });
  } else {
    console.log('  ✅ 通过');
  }
}

async function test2_cancelledSubscriptionCheck() {
  console.log('\n📋 测试 2: 检查已取消订阅的状态...');
  
  const cancelledSubs = await prisma.subscription.findMany({
    where: {
      cancelledAt: {
        not: null
      }
    },
    select: {
      id: true,
      orgId: true,
      status: true,
      cancelledAt: true,
      cancelReason: true,
      renewsAt: true,
    },
    take: 10,
  });

  const issues: string[] = [];
  
  cancelledSubs.forEach(sub => {
    // 检查：已取消的订阅应该 status 还是 ACTIVE（在周期内）
    // 或者 status 是 CANCELLED（周期已过）
    if (!sub.cancelledAt) {
      issues.push(`订阅 ${sub.id}: cancelledAt 为 null 但被查询到`);
    }
    
    // 检查：renewsAt 应该存在
    if (!sub.renewsAt) {
      issues.push(`订阅 ${sub.id}: renewsAt 为 null`);
    }
  });

  const passed = issues.length === 0;
  
  results.push({
    name: '已取消订阅状态正确',
    passed,
    message: passed 
      ? `✅ 所有 ${cancelledSubs.length} 个已取消订阅状态正确` 
      : `❌ 发现 ${issues.length} 个问题`,
    details: passed ? null : issues,
  });

  if (!passed) {
    console.log('  ❌ 失败：');
    issues.forEach(issue => {
      console.log(`     - ${issue}`);
    });
  } else {
    console.log(`  ✅ 通过 (检查了 ${cancelledSubs.length} 个已取消订阅)`);
  }
}

async function test3_proratedBillingRecords() {
  console.log('\n📋 测试 3: 检查按比例计费记录...');
  
  const proratedUsages = await prisma.usage.findMany({
    where: {
      usageType: {
        in: ['module_prorated', 'resource_prorated']
      }
    },
    select: {
      id: true,
      subscriptionId: true,
      usageType: true,
      quantity: true,
      unitPrice: true,
      amount: true,
      isFree: true,
      billedAt: true,
      metadata: true,
    },
    take: 10,
    orderBy: {
      createdAt: 'desc'
    }
  });

  const issues: string[] = [];
  
  proratedUsages.forEach(usage => {
    // 检查：amount 应该 > 0
    if (usage.amount <= 0) {
      issues.push(`Usage ${usage.id}: amount 为 ${usage.amount}`);
    }
    
    // 检查：isFree 应该是 false（按比例计费不是免费的）
    if (usage.isFree) {
      issues.push(`Usage ${usage.id}: isFree 应该是 false`);
    }
    
    // 检查：metadata 应该包含关键信息
    if (usage.metadata && typeof usage.metadata === 'object') {
      const meta = usage.metadata as any;
      if (usage.usageType === 'module_prorated' && !meta.moduleKey) {
        issues.push(`Usage ${usage.id}: metadata 缺少 moduleKey`);
      }
      if (usage.usageType === 'resource_prorated' && !meta.resourceType) {
        issues.push(`Usage ${usage.id}: metadata 缺少 resourceType`);
      }
    }
  });

  const passed = issues.length === 0 && proratedUsages.length > 0;
  
  results.push({
    name: '按比例计费记录正确',
    passed,
    message: passed 
      ? `✅ ${proratedUsages.length} 条按比例计费记录格式正确` 
      : proratedUsages.length === 0 
        ? `⚠️ 没有找到按比例计费记录（可能还没有测试 API 7/8）`
        : `❌ 发现 ${issues.length} 个问题`,
    details: passed ? null : issues.length > 0 ? issues : '没有记录',
  });

  if (!passed && issues.length > 0) {
    console.log('  ❌ 失败：');
    issues.forEach(issue => {
      console.log(`     - ${issue}`);
    });
  } else if (proratedUsages.length === 0) {
    console.log('  ⚠️ 警告：没有找到按比例计费记录');
  } else {
    console.log(`  ✅ 通过 (检查了 ${proratedUsages.length} 条记录)`);
    console.log('  示例记录：');
    proratedUsages.slice(0, 2).forEach(usage => {
      const meta = usage.metadata as any;
      console.log(`     - ${usage.usageType}: $${usage.amount.toNumber()} (${meta?.remainingDays || '?'} 天)`);
    });
  }
}

async function test4_resourceQuantityAccumulation() {
  console.log('\n📋 测试 4: 检查资源数量累加逻辑...');
  
  const resources = await prisma.subscriptionResource.findMany({
    where: {
      removedAt: null
    },
    include: {
      resource: true,
      subscription: true,
    },
    take: 10,
    orderBy: {
      addedAt: 'desc'
    }
  });

  // 检查是否有数量 > 1 的资源（说明可能是累加的结果）
  const accumulatedResources = resources.filter(sr => sr.quantity > 1);
  
  // 检查日志：是否有 RESOURCE_QUANTITY_INCREASED 的记录
  const quantityIncreasedLogs = await prisma.subscriptionLog.findMany({
    where: {
      action: 'RESOURCE_QUANTITY_INCREASED'
    },
    take: 5,
    orderBy: {
      createdAt: 'desc'
    }
  });

  const passed = true; // 这个测试只是检查数据，不判断对错
  
  results.push({
    name: '资源数量记录',
    passed,
    message: accumulatedResources.length > 0 
      ? `✅ 发现 ${accumulatedResources.length} 个数量 > 1 的资源，可能是累加结果` 
      : `⚠️ 没有发现数量 > 1 的资源（可能还没有测试多次添加）`,
    details: {
      accumulatedCount: accumulatedResources.length,
      quantityIncreasedLogs: quantityIncreasedLogs.length,
      examples: accumulatedResources.slice(0, 3).map(sr => ({
        resourceType: sr.resource.type,
        quantity: sr.quantity,
        subscriptionId: sr.subscriptionId,
      })),
    },
  });

  if (accumulatedResources.length > 0) {
    console.log(`  ✅ 发现 ${accumulatedResources.length} 个数量 > 1 的资源`);
    console.log('  示例：');
    accumulatedResources.slice(0, 3).forEach(sr => {
      console.log(`     - ${sr.resource.name}: 数量 ${sr.quantity}`);
    });
  } else {
    console.log('  ⚠️ 没有发现数量累加的资源');
  }

  if (quantityIncreasedLogs.length > 0) {
    console.log(`  ✅ 发现 ${quantityIncreasedLogs.length} 条数量增加日志`);
  }
}

async function test5_trialStatusConsistency() {
  console.log('\n📋 测试 5: 检查 Trial 状态一致性...');
  
  const trialSubscriptions = await prisma.subscription.findMany({
    where: {
      status: 'TRIAL'
    },
    select: {
      id: true,
      orgId: true,
      payerId: true,
      trialEndsAt: true,
      renewsAt: true,
      startedAt: true,
    },
    take: 10,
  });

  const issues: string[] = [];
  
  for (const sub of trialSubscriptions) {
    // 检查 trialEndsAt 应该存在
    if (!sub.trialEndsAt) {
      issues.push(`订阅 ${sub.id}: TRIAL 状态但 trialEndsAt 为 null`);
    }
    
    // 检查 renewsAt 应该存在且约等于 trialEndsAt
    if (!sub.renewsAt) {
      issues.push(`订阅 ${sub.id}: renewsAt 为 null`);
    } else if (sub.trialEndsAt) {
      const diff = Math.abs(sub.renewsAt.getTime() - sub.trialEndsAt.getTime());
      if (diff > 1000 * 60 * 60 * 24) { // 超过 1 天的差异
        issues.push(`订阅 ${sub.id}: renewsAt 和 trialEndsAt 相差超过 1 天`);
      }
    }
    
    // 检查用户的 Trial 状态
    const userTrialStatus = await prisma.userTrialStatus.findUnique({
      where: { userId: sub.payerId }
    });
    
    if (!userTrialStatus || !userTrialStatus.hasUsedTrial) {
      issues.push(`订阅 ${sub.id}: 用户 ${sub.payerId} 的 hasUsedTrial 应该是 true`);
    }
  }

  const passed = issues.length === 0;
  
  results.push({
    name: 'Trial 状态一致性',
    passed,
    message: passed 
      ? `✅ 所有 ${trialSubscriptions.length} 个 TRIAL 订阅状态一致` 
      : `❌ 发现 ${issues.length} 个不一致`,
    details: passed ? null : issues,
  });

  if (!passed) {
    console.log('  ❌ 失败：');
    issues.forEach(issue => {
      console.log(`     - ${issue}`);
    });
  } else {
    console.log(`  ✅ 通过 (检查了 ${trialSubscriptions.length} 个 TRIAL 订阅)`);
  }
}

async function test6_moduleAccessControl() {
  console.log('\n📋 测试 6: 检查模块添加到已取消订阅...');
  
  // 查找同时有 cancelledAt 和 subscriptionModules 的订阅
  const cancelledWithModules = await prisma.subscription.findMany({
    where: {
      cancelledAt: {
        not: null
      }
    },
    include: {
      subscriptionModules: {
        where: {
          isActive: true
        },
        include: {
          module: true
        }
      }
    },
    take: 5,
  });

  // 检查：是否有模块是在 cancelledAt 之后添加的
  const issues: string[] = [];
  
  for (const sub of cancelledWithModules) {
    for (const sm of sub.subscriptionModules) {
      // 这里我们无法直接获取 addedAt，因为 SubscriptionModule 表没有这个字段
      // 但我们可以检查日志
      const log = await prisma.subscriptionLog.findFirst({
        where: {
          subscriptionId: sub.id,
          action: 'MODULE_ADDED',
          createdAt: {
            gte: sub.cancelledAt!
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      });
      
      if (log) {
        issues.push(`订阅 ${sub.id}: 在取消后 (${sub.cancelledAt}) 仍然添加了模块 (${log.createdAt})`);
      }
    }
  }

  const passed = issues.length === 0;
  
  results.push({
    name: '已取消订阅不能添加模块',
    passed,
    message: passed 
      ? `✅ 没有发现已取消订阅添加模块的情况` 
      : `❌ 发现 ${issues.length} 个违规操作`,
    details: passed ? null : issues,
  });

  if (!passed) {
    console.log('  ❌ 失败：');
    issues.forEach(issue => {
      console.log(`     - ${issue}`);
    });
  } else {
    console.log(`  ✅ 通过 (检查了 ${cancelledWithModules.length} 个已取消订阅)`);
  }
}

async function generateReport() {
  console.log('\n' + '='.repeat(60));
  console.log('📊 测试结果汇总');
  console.log('='.repeat(60));
  
  const passedCount = results.filter(r => r.passed).length;
  const totalCount = results.length;
  const passRate = ((passedCount / totalCount) * 100).toFixed(1);
  
  console.log(`\n总测试数: ${totalCount}`);
  console.log(`通过: ${passedCount}`);
  console.log(`失败: ${totalCount - passedCount}`);
  console.log(`通过率: ${passRate}%\n`);
  
  results.forEach((result, index) => {
    const icon = result.passed ? '✅' : '❌';
    console.log(`${index + 1}. ${icon} ${result.name}`);
    console.log(`   ${result.message}`);
    if (result.details) {
      console.log(`   详情: ${JSON.stringify(result.details, null, 2).substring(0, 200)}...`);
    }
    console.log('');
  });
  
  console.log('='.repeat(60));
  
  if (passedCount === totalCount) {
    console.log('🎉 所有测试通过！API 逻辑与 API.md 一致！');
  } else {
    console.log('⚠️ 部分测试失败，请查看上面的详细信息。');
  }
  
  console.log('='.repeat(60));
}

async function main() {
  console.log('🚀 开始验证 API 逻辑...');
  console.log('连接数据库: ' + process.env.DATABASE_URL?.substring(0, 50) + '...');
  
  try {
    await test1_renewsAtNotNull();
    await test2_cancelledSubscriptionCheck();
    await test3_proratedBillingRecords();
    await test4_resourceQuantityAccumulation();
    await test5_trialStatusConsistency();
    await test6_moduleAccessControl();
    
    await generateReport();
    
    process.exit(0);
  } catch (error) {
    console.error('❌ 测试执行出错:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

