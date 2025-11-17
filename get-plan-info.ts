import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function getPlanInfo() {
  try {
    const plan = await prisma.plan.findFirst({
      where: { status: 'ACTIVE' },
      include: { 
        tiers: true,
      },
    });

    if (plan) {
      console.log('✅ 找到活跃Plan:');
      console.log(`   Plan Key: ${plan.key}`);
      console.log(`   Plan Name: ${plan.name}`);
      console.log(`   Stripe Price ID: ${plan.stripePriceId}`);
      console.log('\n可用的测试Price ID:', plan.stripePriceId);
    } else {
      console.log('❌ 未找到活跃的Plan');
    }
  } catch (error) {
    console.error('查询失败:', error);
  } finally {
    await prisma.$disconnect();
  }
}

getPlanInfo();

