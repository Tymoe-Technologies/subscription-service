# Subscription Service Internal Manual

> **内部技术手册** - 深度解析订阅服务的实现细节、运维指南和问题排查流程

## 📋 目录

1. [系统架构深度解析](#系统架构深度解析)
2. [权限系统实现](#权限系统实现)
3. [多地区支持机制](#多地区支持机制)
4. [订阅生命周期管理](#订阅生命周期管理)
5. [Intent幂等性实现](#intent幂等性实现)
6. [Webhook处理机制](#webhook处理机制)
7. [审计日志系统](#审计日志系统)
8. [运维操作手册](#运维操作手册)
9. [问题排查指南](#问题排查指南)
10. [性能优化建议](#性能优化建议)

## 🏗️ 系统架构深度解析

### 核心设计理念

我们的订阅服务基于以下核心原则构建：

1. **Single Source of Truth (SSOT)**: Stripe作为订阅状态的唯一真相来源
2. **Event-Driven Architecture**: 基于Webhook事件驱动的状态同步
3. **Intent-Based Operations**: 防止竞态条件的Intent模式
4. **Entitlement-Based Permissions**: 数据驱动的权限系统
5. **Multi-Region Support**: 支持多地区定价和货币

### 数据流向

```mermaid
graph TD
    A[用户请求] --> B[创建Intent]
    B --> C[Stripe Checkout]
    C --> D[用户完成支付]
    D --> E[Stripe Webhook]
    E --> F[更新Intent状态]
    F --> G[同步订阅状态]
    G --> H[更新权限缓存]
```

### 关键组件

#### 1. Intent Service (`subscriptionIntent.service.ts`)
- **职责**: 管理所有付费操作的Intent
- **特性**: 乐观锁、版本控制、过期管理
- **防护**: 防止重复处理、竞态条件
- **版本控制**: 使用`version`字段实现乐观锁，防止并发更新冲突

#### 2. Subscription Service (`subscription.service.ts`)
- **职责**: 订阅生命周期管理
- **特性**: 多地区支持、权限检查、状态同步
- **核心方法**: `getOrganizationFeatures`, `isSubscriptionActive`

#### 3. Webhook Service (`webhook.service.ts`)
- **职责**: 处理Stripe事件
- **特性**: 幂等性保证、错误重试、事件去重
- **安全**: 签名验证、事件类型白名单

## 🔑 权限系统实现

### Entitlement表结构

```sql
-- 权限配置示例
INSERT INTO Entitlement (levelKey, featureKey, isEnabled, limit) VALUES
  ('trial', 'api_requests', true, 1000),
  ('basic', 'api_requests', true, 10000),
  ('standard', 'api_requests', true, 50000),
  ('advanced', 'api_requests', true, 200000),
  ('pro', 'api_requests', true, 1000000);
```

### 权限检查流程

```typescript
// 核心权限检查逻辑
async getOrganizationFeatures(organizationId: string) {
  // 1. 获取有效订阅
  const subscription = await this.getActiveSubscription(organizationId);

  // 2. 基于订阅级别查询权限
  const entitlements = await prisma.entitlement.findMany({
    where: { levelKey: subscription.tier },
    include: { feature: true }
  });

  // 3. 构建权限对象
  const features = {};
  for (const entitlement of entitlements) {
    features[entitlement.feature.key] = {
      isEnabled: entitlement.isEnabled,
      limit: entitlement.limit,
      unit: entitlement.feature.unit
    };
  }

  return { level: subscription.tier, features };
}
```

### 权限缓存策略

为了提高性能，权限信息在组织控制器中缓存10分钟：

```typescript
// 组织缓存信息API
export async function getOrganizationCacheInfo(req: Request, res: Response) {
  const cacheValidUntil = new Date(Date.now() + 10 * 60 * 1000); // 10分钟

  res.json({
    success: true,
    data: {
      organizationId,
      subscriptions: enrichedSubscriptions,
      cacheValidUntil: cacheValidUntil.toISOString(),
      lastUpdated: new Date().toISOString(),
    },
  });
}
```

## 🌍 多地区支持机制

### 地区配置 (`config/defaults.ts`)

```typescript
export const SUPPORTED_REGIONS = {
  CA: 'Canada',
  US: 'United States',
  EU: 'European Union',
  GB: 'United Kingdom',
  AU: 'Australia',
} as const;

export const REGION_CURRENCIES = {
  CA: 'CAD',
  US: 'USD',
  EU: 'EUR',
  GB: 'GBP',
  AU: 'AUD',
} as const;
```

### 价格查询逻辑

```typescript
// 订阅服务中的多地区价格查询
async createCheckoutSession({ region, ...params }) {
  const normalizedRegion = region && isValidRegion(region) ? region : DEFAULT_REGION;
  const currency = getRegionCurrency(normalizedRegion);

  const price = await prisma.price.findFirst({
    where: {
      productKey: params.productKey,
      tier: params.targetTier,
      billingCycle: params.targetBillingCycle,
      region: normalizedRegion  // 地区过滤
    }
  });

  // Stripe Checkout Session包含货币信息
  const sessionParams = {
    priceId: price.stripePriceId,
    currency: currency.toLowerCase(),
    metadata: { region: normalizedRegion, currency }
  };
}
```

### 多地区Stripe账户

环境变量支持多个Stripe账户：

```bash
# 可选的多地区Stripe配置
STRIPE_ACCOUNT_CA=sk_test_ca_...
STRIPE_ACCOUNT_US=sk_test_us_...
STRIPE_ACCOUNT_EU=sk_test_eu_...
```

当前实现使用主Stripe账户，未来可扩展为地区特定账户。

## 📅 订阅生命周期管理

### 状态转换图

```
[trialing] → [active] → [past_due] → [expired]
    ↓           ↓           ↓
[canceled]  [canceled]  [canceled]
```

**状态说明**:
- `TRIALING`: 试用期状态，有效期为trialEnd
- `ACTIVE`: 活跃订阅，正常付费状态
- `PAST_DUE`: 逾期状态，进入宽限期
- `CANCELED`: 已取消，不再续费
- `EXPIRED`: 已过期，服务已停止

### 过期逻辑实现

```typescript
// 增强的订阅状态检查
isSubscriptionActive(subscription: Subscription): boolean {
  if (!subscription || subscription.status === 'canceled') {
    return false;
  }

  const now = new Date();

  // 检查试用期
  if (subscription.status === 'trialing') {
    return !subscription.trialEnd || subscription.trialEnd > now;
  }

  // 检查宽限期（优先级最高）
  if (subscription.gracePeriodEnd) {
    return subscription.gracePeriodEnd > now;
  }

  // 检查正常期限
  if (subscription.currentPeriodEnd) {
    return subscription.currentPeriodEnd > now;
  }

  return subscription.status === 'active';
}
```

### 宽限期机制

宽限期在以下情况下启用：
1. 支付失败但订阅未立即取消
2. 需要给用户额外时间更新支付方式
3. 管理员手动设置宽限期

```typescript
// 宽限期设置示例
await prisma.subscription.update({
  where: { id: subscriptionId },
  data: {
    gracePeriodEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7天宽限期
  }
});
```

## 🔄 Intent幂等性实现

### Intent生命周期

```typescript
// Intent状态枚举
enum SUBSCRIPTION_INTENT_STATUS {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
  EXPIRED = 'expired'
}
```

### 乐观锁实现

`SubscriptionIntent`表使用`version`字段实现乐观锁机制，确保并发更新安全：

**版本字段说明**:
- `version`: Int类型，默认值为1，每次更新时递增
- 作用: 防止多个进程同时修改同一Intent造成数据不一致
- 场景: Webhook处理、用户操作、定时任务可能同时触发Intent更新

```typescript
// 带版本控制的Intent更新
async updateIntentStatus(intentId: string, status: string, stripeSubscriptionId?: string) {
  // 1. 获取当前版本
  const currentIntent = await prisma.subscriptionIntent.findUnique({
    where: { id: intentId }
  });

  if (!currentIntent) {
    throw new Error('Intent not found');
  }

  // 2. 乐观锁更新
  try {
    const intent = await prisma.subscriptionIntent.update({
      where: {
        id: intentId,
        version: currentIntent.version // 乐观锁条件
      },
      data: {
        status,
        stripeSubscriptionId,
        version: currentIntent.version + 1 // 版本递增
      }
    });

    return intent;
  } catch (error) {
    // 3. 处理版本冲突 (Prisma错误码P2025)
    if (error.code === 'P2025') {
      throw new Error(`Intent version conflict - another process updated this intent: ${intentId}`);
    }
    throw error;
  }
}
```

### Intent过期清理

定时任务清理过期Intent：

```typescript
// 清理过期Intent
async expireOldIntents() {
  const result = await prisma.subscriptionIntent.updateMany({
    where: {
      status: SUBSCRIPTION_INTENT_STATUS.PENDING,
      expiresAt: { lt: new Date() }
    },
    data: {
      status: SUBSCRIPTION_INTENT_STATUS.EXPIRED
    }
  });

  logger.info('Expired old subscription intents', {
    expiredCount: result.count
  });
}
```

## 🪝 Webhook处理机制

### 事件幂等性

```typescript
// Webhook幂等性实现
async processWebhook(event: Stripe.Event) {
  // 1. 检查事件是否已处理
  const existingEvent = await prisma.stripeEventProcessed.findUnique({
    where: { id: event.id }
  });

  if (existingEvent && existingEvent.processed) {
    logger.info('Event already processed', { eventId: event.id });
    return;
  }

  // 2. 创建处理记录
  await prisma.stripeEventProcessed.upsert({
    where: { id: event.id },
    create: {
      id: event.id,
      eventType: event.type,
      processed: false,
      attempts: 1
    },
    update: {
      attempts: { increment: 1 }
    }
  });

  // 3. 处理事件
  try {
    await this.handleEventByType(event);

    // 4. 标记为已处理
    await prisma.stripeEventProcessed.update({
      where: { id: event.id },
      data: {
        processed: true,
        processedAt: new Date()
      }
    });
  } catch (error) {
    // 5. 记录错误
    await prisma.stripeEventProcessed.update({
      where: { id: event.id },
      data: {
        lastError: error.message,
        attempts: { increment: 1 }
      }
    });
    throw error;
  }
}
```

### 支持的事件类型

| 事件类型 | 处理逻辑 | 影响 |
|---------|---------|------|
| `checkout.session.completed` | 创建或更新订阅 | 新订阅或升级 |
| `customer.subscription.created` | 同步订阅状态 | 订阅激活 |
| `customer.subscription.updated` | 更新订阅信息 | 状态变更 |
| `customer.subscription.deleted` | 取消订阅 | 订阅终止 |
| `invoice.payment_succeeded` | 续费成功 | 延长周期 |
| `invoice.payment_failed` | 支付失败 | 可能暂停 |

## 📊 审计日志系统

### 日志记录原则

1. **记录什么**: 所有影响订阅状态的操作
2. **记录时机**: 操作前后都记录，包含变更详情
3. **记录格式**: 结构化JSON，便于查询分析
4. **保留期限**: 至少保留2年，满足合规要求

### 审计日志示例

```typescript
// 典型的审计日志记录
await auditService.logIntentChange(
  intentId,
  'UPDATE',      // 操作类型
  'WEBHOOK',     // 操作者类型
  null,          // 操作者ID（Webhook为系统操作）
  {              // 变更详情
    status: { from: 'pending', to: 'completed' },
    stripeSubscriptionId: { from: null, to: 'sub_xxx' }
  }
);
```

### 查询审计日志

```sql
-- 查询特定订阅的所有变更历史
SELECT
  timestamp,
  action,
  actorType,
  changes,
  metadata
FROM AuditLog
WHERE entityType = 'SUBSCRIPTION'
  AND entityId = 'sub-123'
ORDER BY timestamp DESC;

-- 查询管理员操作记录
SELECT
  timestamp,
  entityType,
  entityId,
  action,
  actorId,
  changes
FROM AuditLog
WHERE actorType = 'ADMIN'
  AND timestamp >= NOW() - INTERVAL 30 DAY
ORDER BY timestamp DESC;
```

## 🛠️ 运维操作手册

### 日常监控指标

1. **服务健康**:
   ```bash
   curl http://localhost:8088/health
   ```

2. **数据库连接**:
   ```bash
   # 检查Prisma连接
   npx prisma db pull
   ```

3. **Webhook延迟**:
   ```sql
   SELECT
     eventType,
     COUNT(*) as total,
     AVG(EXTRACT(EPOCH FROM (processedAt - createdAt))) as avg_delay_seconds
   FROM StripeEventProcessed
   WHERE processedAt IS NOT NULL
   GROUP BY eventType;
   ```

### 紧急操作命令

#### 1. 强制同步订阅状态

```bash
# 通过API强制同步特定组织的订阅
curl -X POST http://localhost:8088/admin/organizations/{orgId}/sync \
  -H "X-API-Key: $INTERNAL_API_KEY" \
  -H "Content-Type: application/json"
```

#### 2. 手动处理失败的Webhook

```bash
# 重新处理失败的Webhook事件
curl -X POST http://localhost:8088/admin/webhooks/retry \
  -H "X-API-Key: $INTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"eventId": "evt_xxx"}'
```

#### 3. 清理过期Intent

```bash
# 手动触发Intent清理
curl -X POST http://localhost:8088/admin/intents/cleanup \
  -H "X-API-Key: $INTERNAL_API_KEY"
```

### ⚠️ Admin API 使用说明

**重要警告**: Admin API仅限运维和故障修复用途，生产环境严禁直接使用Admin API创建付费订阅。

**使用原则**:
1. **仅限维护**: Admin API只能用于数据修复、状态同步等维护操作
2. **审计要求**: 所有Admin API调用必须记录到AuditLog中
3. **权限控制**: 需要`INTERNAL_API_KEY`认证，密钥应妥善保管
4. **操作日志**: 每次使用Admin API都应记录操作原因和结果

**Admin API 端点**:
- `POST /admin/subscriptions` - 创建订阅 (⚠️ 默认禁用，需要ADMIN_MAINTENANCE_MODE=true)
- `GET /admin/subscriptions` - 查询所有订阅
- `GET /admin/organizations` - 查询所有组织
- `GET /admin/webhook-events` - 查询Webhook事件
- `GET /admin/audit-logs` - 查询审计日志
- `GET /admin/stats` - 查询统计数据

**注意事项**:
- **POST /admin/subscriptions**: 默认禁用，仅在设置`ADMIN_MAINTENANCE_MODE=true`时启用
- 所有Admin API操作都会自动写入审计日志，包含操作者、时间、原因等信息
- 使用Admin API修改数据前，必须先了解影响范围和业务影响
- 关键操作建议先在测试环境验证，确保不会影响生产数据
- 创建订阅时必须提供`reason`和`ticketId`用于审计追踪

#### AuditLog 审计日志说明

所有Admin API操作都会自动记录到AuditLog表中，用于合规性审计和问题排查：

**AuditLog表结构**:
```prisma
model AuditLog {
  id         String   @id @default(cuid())
  entityType String   // SUBSCRIPTION|ORGANIZATION|TRIAL|INTENT
  entityId   String?  // 被操作的实体ID
  action     String   // CREATE|UPDATE|DELETE|CANCEL|REACTIVATE
  actorType  String   // USER|ADMIN|WEBHOOK|SYSTEM
  actorId    String?  // 操作者标识
  changes    Json?    // 具体变更内容
  metadata   Json?    // 附加信息 (ticketId, reason等)
  timestamp  DateTime @default(now())
}
```

**Admin API审计记录示例**:
```json
{
  "entityType": "SUBSCRIPTION",
  "entityId": "sub_abc123",
  "action": "CREATE",
  "actorType": "ADMIN",
  "actorId": "admin-user-id",
  "changes": {
    "organizationId": "org-123",
    "productKey": "ploml",
    "status": "ACTIVE",
    "tier": "basic"
  },
  "metadata": {
    "ticketId": "SUPPORT-12345",
    "reason": "Customer payment issue resolution",
    "apiEndpoint": "POST /admin/subscriptions"
  }
}
```

**审计日志查询**:
```bash
# 查询特定实体的操作历史
GET /admin/audit-logs?entityType=SUBSCRIPTION&entityId=sub_abc123

# 查询特定管理员的操作记录
GET /admin/audit-logs?actorType=ADMIN&actorId=admin-user-id

# 查询指定时间范围的操作
GET /admin/audit-logs?startDate=2024-01-01&endDate=2024-01-31
```

通过审计日志可以：
1. 追踪订阅状态变更的完整历史
2. 确定每次操作的责任人和原因
3. 满足SOX/SOC合规要求
4. 快速定位和排查数据异常问题

### 配置热更新

部分配置支持热更新，无需重启服务：

```bash
# 更新维护模式状态
export ADMIN_MAINTENANCE_MODE=true

# 更新日志级别
export LOG_LEVEL=debug
```

### 数据库维护

#### 清理历史数据

```sql
-- 清理超过2年的审计日志（保留合规记录）
DELETE FROM AuditLog
WHERE timestamp < NOW() - INTERVAL 2 YEAR
  AND entityType NOT IN ('SUBSCRIPTION', 'ORGANIZATION');

-- 清理已处理的旧Webhook记录（保留30天）
DELETE FROM StripeEventProcessed
WHERE processed = true
  AND processedAt < NOW() - INTERVAL 30 DAY;
```

#### 索引优化

```sql
-- 为常用查询创建索引
CREATE INDEX IF NOT EXISTS idx_subscription_org_product
ON Subscription(organizationId, productKey);

CREATE INDEX IF NOT EXISTS idx_audit_entity_timestamp
ON AuditLog(entityType, entityId, timestamp);

CREATE INDEX IF NOT EXISTS idx_intent_status_expires
ON SubscriptionIntent(status, expiresAt);
```

## 🔍 问题排查指南

### 常见问题及解决方案

#### 1. JWT验证失败

**症状**: API返回401错误，日志显示JWT验证失败

**排查步骤**:
```bash
# 1. 检查JWKS URL可访问性
curl -I $JWKS_URL

# 2. 验证JWT格式
echo $JWT_TOKEN | base64 -d

# 3. 检查token时间戳
date -d @$(echo $JWT_TOKEN | cut -d. -f2 | base64 -d | jq .exp)
```

**解决方案**:
- 确保JWKS_URL正确且可访问
- 检查token的iss和aud声明
- 确认token未过期

#### 2. Webhook处理延迟

**症状**: Stripe事件处理缓慢，订阅状态更新不及时

**排查步骤**:
```bash
# 1. 检查未处理的事件
psql $DATABASE_URL -c "
SELECT eventType, COUNT(*)
FROM StripeEventProcessed
WHERE processed = false
GROUP BY eventType;"

# 2. 检查处理延迟
psql $DATABASE_URL -c "
SELECT
  eventType,
  AVG(EXTRACT(EPOCH FROM (processedAt - createdAt))) as delay_seconds
FROM StripeEventProcessed
WHERE processedAt > NOW() - INTERVAL 1 HOUR
GROUP BY eventType;"
```

**解决方案**:
- 检查数据库性能
- 增加Webhook处理并发度
- 优化数据库查询

#### 3. Intent版本冲突

**症状**: 日志中出现"Intent version conflict"错误

**排查步骤**:
```bash
# 检查并发处理情况
psql $DATABASE_URL -c "
SELECT
  id,
  status,
  version,
  updatedAt
FROM SubscriptionIntent
WHERE updatedAt > NOW() - INTERVAL 1 HOUR
ORDER BY updatedAt DESC
LIMIT 20;"
```

**解决方案**:
- 实现指数退避重试机制
- 检查是否有重复的Webhook事件
- 优化乐观锁冲突处理

#### 4. 权限缓存不一致

**症状**: 用户权限更新后，前端显示仍为旧权限

**排查步骤**:
```bash
# 1. 检查订阅状态
curl -H "Authorization: Bearer $JWT" \
  http://localhost:8088/organizations/$ORG_ID/subscriptions

# 2. 检查缓存时间戳
curl -H "Authorization: Bearer $JWT" \
  http://localhost:8088/organizations/$ORG_ID/cache-info
```

**解决方案**:
- 等待缓存过期（10分钟）
- 手动触发权限重新计算
- 检查订阅状态是否正确更新

### 性能监控查询

```sql
-- 慢查询监控
SELECT
  query,
  mean_time,
  calls,
  total_time
FROM pg_stat_statements
WHERE mean_time > 100  -- 超过100ms的查询
ORDER BY mean_time DESC;

-- 活跃连接监控
SELECT
  state,
  COUNT(*) as connection_count
FROM pg_stat_activity
WHERE datname = 'subscription-service'
GROUP BY state;

-- 表大小监控
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

## 🚀 性能优化建议

### 数据库优化

1. **连接池配置**:
   ```bash
   # 环境变量
   DATABASE_URL="postgresql://user:pass@host:5432/db?connection_limit=20&pool_timeout=20"
   ```

2. **查询优化**:
   - 为频繁查询的字段创建索引
   - 使用合适的分页参数
   - 避免N+1查询问题

3. **数据清理**:
   - 定期清理历史审计日志
   - 归档旧的Webhook事件记录
   - 清理过期的Intent记录

### 应用级优化

1. **缓存策略**:
   - 权限信息缓存10分钟
   - JWKS公钥缓存1小时
   - 产品配置缓存

2. **并发控制**:
   - 限制Webhook处理并发数
   - 使用队列处理耗时操作
   - 实现熔断机制

3. **监控告警**:
   - API响应时间监控
   - 数据库连接数监控
   - Webhook处理延迟告警

### 扩容建议

当服务达到以下指标时考虑扩容：

- API平均响应时间 > 500ms
- 数据库连接使用率 > 80%
- Webhook处理延迟 > 30秒
- CPU使用率持续 > 70%

扩容选项：
1. **水平扩容**: 增加服务实例数量
2. **数据库扩容**: 增加数据库连接数或读副本
3. **缓存优化**: 引入Redis缓存层

---

**文档维护**: 本手册应随系统更新及时维护，建议每月review一次。

**联系方式**: 如需技术支持或有改进建议，请联系开发团队。