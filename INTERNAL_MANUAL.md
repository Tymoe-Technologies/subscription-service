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
curl -X POST http://localhost:8088/api/subscription-service/v1/admin/organizations/{orgId}/sync \
  -H "X-API-Key: $INTERNAL_API_KEY" \
  -H "Content-Type: application/json"
```

#### 2. 手动处理失败的Webhook

```bash
# 重新处理失败的Webhook事件
curl -X POST http://localhost:8088/api/subscription-service/v1/admin/webhooks/retry \
  -H "X-API-Key: $INTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"eventId": "evt_xxx"}'
```

#### 3. 清理过期Intent

```bash
# 手动触发Intent清理
curl -X POST http://localhost:8088/api/subscription-service/v1/admin/intents/cleanup \
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
  http://localhost:8088/api/subscription-service/v1/organizations/$ORG_ID/subscriptions

# 2. 检查缓存时间戳
curl -H "Authorization: Bearer $JWT" \
  http://localhost:8088/api/subscription-service/v1/organizations/$ORG_ID/cache-info
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

## 📚 API路由技术规格

> **白皮书级详细文档** - 每个路由的完整技术规格，包含使用者、输入输出、业务逻辑和场景说明

### 🎯 前端用户API (Frontend User APIs)

这类API为前端应用提供用户直接操作功能，包括组织管理、订阅购买、试用申请等。

#### GET /api/subscription-service/v1/frontend/user/organizations-overview {#frontend-user-organizations-overview}

**功能**: 获取当前用户所有组织的概览信息
**调用方**: 前端应用
**认证**: JWT Token (必需)

**URL格式**:
```
GET /api/subscription-service/v1/frontend/user/organizations-overview
```

**请求头**:
```
Authorization: Bearer {jwt_token}
Content-Type: application/json
```

**请求参数**: 无

**成功响应** (200):
```json
{
  "success": true,
  "data": {
    "organizations": [
      {
        "id": "org-abc123",
        "name": "My Company",
        "hasUsedTrial": false,
        "subscription": {
          "id": "sub-xyz789",
          "productKey": "ploml",
          "tier": "basic",
          "status": "ACTIVE",
          "billingCycle": "monthly",
          "currentPeriodStart": "2024-01-01T00:00:00Z",
          "currentPeriodEnd": "2024-02-01T00:00:00Z",
          "gracePeriodEnd": "2024-02-08T00:00:00Z",
          "cancelAtPeriodEnd": false
        },
        "features": {
          "api_requests": {
            "isEnabled": true,
            "limit": 10000,
            "unit": "requests/month"
          }
        }
      }
    ]
  }
}
```

**失败响应**:
- **401 Unauthorized**: JWT token无效或缺失
```json
{
  "success": false,
  "error": {
    "code": "unauthorized",
    "message": "Missing authorization token"
  }
}
```

**调用逻辑**:
1. 从JWT token中解析用户ID和组织列表
2. 为每个组织查询活跃订阅状态
3. 基于订阅tier查询功能权限
4. 构建包含订阅和权限信息的组织概览

**业务场景**:
- 用户登录后的首页数据加载
- 组织切换时的权限检查
- 订阅状态监控面板

**数据库操作**:
- 查询: `Organization`, `Subscription`, `Entitlement`, `Feature`
- 索引: `idx_subscription_org_product`, `idx_entitlement_level_feature`

---

#### POST /api/subscription-service/v1/frontend/user/organizations {#frontend-user-organizations-create}

**功能**: 创建新组织
**调用方**: 前端应用
**认证**: JWT Token (必需)

**URL格式**:
```
POST /api/subscription-service/v1/frontend/user/organizations
```

**请求头**:
```
Authorization: Bearer {jwt_token}
Content-Type: application/json
```

**请求体**:
```json
{
  "name": "New Organization",
  "region": "US"
}
```

**请求参数**:
- `name` (string, 必需): 组织名称，1-100字符
- `region` (string, 可选): 地区代码，默认为US

**成功响应** (201):
```json
{
  "success": true,
  "data": {
    "organization": {
      "id": "org-new123",
      "name": "New Organization",
      "hasUsedTrial": false,
      "stripeCustomerId": "cus_new123",
      "createdAt": "2024-01-15T10:30:00Z"
    }
  }
}
```

**失败响应**:
- **400 Bad Request**: 输入参数无效
```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Organization name is required",
    "details": {
      "field": "name",
      "value": "",
      "constraint": "min_length_1"
    }
  }
}
```

- **409 Conflict**: 组织名称已存在
```json
{
  "success": false,
  "error": {
    "code": "organization_exists",
    "message": "Organization with this name already exists"
  }
}
```

**调用逻辑**:
1. 验证JWT token和用户身份
2. 验证组织名称的唯一性
3. 创建Stripe Customer记录
4. 在数据库中创建Organization记录
5. 记录审计日志

**业务场景**:
- 新用户注册后创建首个组织
- 现有用户创建新的业务组织
- 团队分离时创建独立组织

**数据库操作**:
- 创建: `Organization`
- 创建: `AuditLog`
- 查询: 组织名称唯一性检查

**Stripe集成**:
- 调用 `stripe.customers.create()` 创建客户记录
- 存储返回的 `customer.id` 到 `stripeCustomerId` 字段

---

#### GET /api/subscription-service/v1/frontend/products/{productKey}/pricing {#frontend-products-pricing}

**功能**: 获取指定产品的定价信息
**调用方**: 前端应用
**认证**: JWT Token (可选)

**URL格式**:
```
GET /api/subscription-service/v1/frontend/products/{productKey}/pricing?region={region}&currency={currency}
```

**路径参数**:
- `productKey` (string, 必需): 产品标识符，如"ploml"

**查询参数**:
- `region` (string, 可选): 地区代码 (US|CA|EU|GB|AU)，默认US
- `currency` (string, 可选): 货币代码 (USD|CAD|EUR|GBP|AUD)，默认USD

**成功响应** (200):
```json
{
  "success": true,
  "data": {
    "product": {
      "key": "ploml",
      "name": "PLOML Service",
      "description": "Premium language model service"
    },
    "pricing": {
      "region": "US",
      "currency": "USD",
      "tiers": [
        {
          "tier": "trial",
          "name": "Trial",
          "order": 0,
          "prices": {
            "monthly": null,
            "annual": null
          },
          "features": {
            "api_requests": {
              "limit": 1000,
              "unit": "requests/month"
            }
          }
        },
        {
          "tier": "basic",
          "name": "Basic",
          "order": 1,
          "prices": {
            "monthly": {
              "amount": 2900,
              "currency": "USD",
              "stripePriceId": "price_basic_monthly_us"
            },
            "annual": {
              "amount": 29000,
              "currency": "USD",
              "stripePriceId": "price_basic_annual_us"
            }
          },
          "features": {
            "api_requests": {
              "limit": 10000,
              "unit": "requests/month"
            }
          }
        }
      ]
    }
  }
}
```

**失败响应**:
- **404 Not Found**: 产品不存在
```json
{
  "success": false,
  "error": {
    "code": "product_not_found",
    "message": "Product 'invalid-key' not found"
  }
}
```

**调用逻辑**:
1. 验证产品key的有效性
2. 根据地区和货币过滤价格
3. 查询产品的所有tier级别
4. 为每个tier加载功能权限信息
5. 构建完整的定价和功能矩阵

**业务场景**:
- 定价页面展示
- 订阅升级选择
- 地区切换时价格更新
- 货币本地化显示

**数据库操作**:
- 查询: `Product`, `Level`, `Price`, `Entitlement`, `Feature`
- 过滤: 按地区、货币、产品key过滤

---

#### GET /api/subscription-service/v1/frontend/products/{productKey}/features {#frontend-products-features}

**功能**: 获取指定产品的功能列表
**调用方**: 前端应用
**认证**: 无需认证

**URL格式**:
```
GET /api/subscription-service/v1/frontend/products/{productKey}/features
```

**路径参数**:
- `productKey` (string, 必需): 产品标识符

**成功响应** (200):
```json
{
  "success": true,
  "data": {
    "product": {
      "key": "ploml",
      "name": "PLOML Service"
    },
    "features": [
      {
        "key": "api_requests",
        "name": "API Requests",
        "description": "Monthly API request quota",
        "type": "usage",
        "unit": "requests/month",
        "tierLimits": {
          "trial": 1000,
          "basic": 10000,
          "standard": 50000,
          "advanced": 200000,
          "pro": 1000000
        }
      },
      {
        "key": "concurrent_requests",
        "name": "Concurrent Requests",
        "description": "Maximum simultaneous API calls",
        "type": "limit",
        "unit": "requests",
        "tierLimits": {
          "trial": 2,
          "basic": 5,
          "standard": 10,
          "advanced": 25,
          "pro": 100
        }
      }
    ]
  }
}
```

**失败响应**:
- **404 Not Found**: 产品不存在

**调用逻辑**:
1. 查询产品信息
2. 获取产品关联的所有功能
3. 汇总各tier级别的功能限制
4. 构建功能对比矩阵

**业务场景**:
- 功能对比页面
- 订阅选择时的功能展示
- 产品介绍页面

---

#### GET /api/subscription-service/v1/frontend/organizations/{organizationId}/subscription-status {#frontend-subscription-status}

**功能**: 查询组织的订阅状态
**调用方**: 前端应用
**认证**: JWT Token (必需)

**URL格式**:
```
GET /api/subscription-service/v1/frontend/organizations/{organizationId}/subscription-status
```

**路径参数**:
- `organizationId` (string, 必需): 组织ID

**成功响应** (200):
```json
{
  "success": true,
  "data": {
    "organization": {
      "id": "org-abc123",
      "name": "My Company",
      "hasUsedTrial": true
    },
    "subscription": {
      "id": "sub-xyz789",
      "productKey": "ploml",
      "tier": "basic",
      "status": "ACTIVE",
      "billingCycle": "monthly",
      "currentPeriodStart": "2024-01-01T00:00:00Z",
      "currentPeriodEnd": "2024-02-01T00:00:00Z",
      "gracePeriodEnd": "2024-02-08T00:00:00Z",
      "cancelAtPeriodEnd": false,
      "stripeSubscriptionId": "sub_stripe123"
    },
    "usage": {
      "api_requests": {
        "current": 3420,
        "limit": 10000,
        "resetDate": "2024-02-01T00:00:00Z"
      }
    },
    "billing": {
      "nextInvoiceDate": "2024-02-01T00:00:00Z",
      "lastPaymentStatus": "succeeded",
      "paymentMethod": {
        "type": "card",
        "last4": "4242",
        "brand": "visa"
      }
    }
  }
}
```

**失败响应**:
- **403 Forbidden**: 无权限访问该组织
```json
{
  "success": false,
  "error": {
    "code": "organization_access_denied",
    "message": "无权限访问该组织"
  }
}
```

- **404 Not Found**: 组织不存在
```json
{
  "success": false,
  "error": {
    "code": "organization_not_found",
    "message": "Organization not found"
  }
}
```

**调用逻辑**:
1. 验证用户对组织的访问权限
2. 查询组织的活跃订阅
3. 获取当前使用量统计
4. 查询Stripe的账单信息
5. 构建完整的订阅状态视图

**业务场景**:
- 订阅管理页面
- 使用量监控
- 账单信息查看
- 续费提醒

**数据库操作**:
- 查询: `Organization`, `Subscription`, `MicroserviceUsage`
- 权限: 验证用户-组织关联

**Stripe集成**:
- 调用 `stripe.subscriptions.retrieve()` 获取最新状态
- 调用 `stripe.invoices.retrieveUpcoming()` 获取下次账单

---

#### GET /api/subscription-service/v1/frontend/organizations/{organizationId}/products/{productKey}/features/{featureKey}/access {#frontend-feature-access}

**功能**: 检查特定功能的访问权限
**调用方**: 前端应用
**认证**: JWT Token (必需)

**URL格式**:
```
GET /api/subscription-service/v1/frontend/organizations/{organizationId}/products/{productKey}/features/{featureKey}/access
```

**路径参数**:
- `organizationId` (string, 必需): 组织ID
- `productKey` (string, 必需): 产品key
- `featureKey` (string, 必需): 功能key

**成功响应** (200):
```json
{
  "success": true,
  "data": {
    "hasAccess": true,
    "feature": {
      "key": "api_requests",
      "name": "API Requests",
      "limit": 10000,
      "unit": "requests/month"
    },
    "usage": {
      "current": 3420,
      "percentage": 34.2,
      "resetDate": "2024-02-01T00:00:00Z"
    },
    "subscription": {
      "tier": "basic",
      "status": "ACTIVE"
    }
  }
}
```

**失败响应**:
- **403 Forbidden**: 无访问权限
```json
{
  "success": false,
  "error": {
    "code": "feature_access_denied",
    "message": "当前订阅级别不支持此功能"
  }
}
```

**调用逻辑**:
1. 验证用户对组织的访问权限
2. 获取组织的活跃订阅
3. 检查订阅tier是否包含该功能
4. 获取功能的当前使用量
5. 计算使用百分比和剩余配额

**业务场景**:
- 功能页面的权限检查
- 使用量显示
- 升级提醒触发
- API调用前的权限预检

---

#### POST /api/subscription-service/v1/frontend/organizations/{organizationId}/subscriptions/start-trial {#frontend-start-trial}

**功能**: 开始试用订阅
**调用方**: 前端应用
**认证**: JWT Token (必需)

**URL格式**:
```
POST /api/subscription-service/v1/frontend/organizations/{organizationId}/subscriptions/start-trial
```

**路径参数**:
- `organizationId` (string, 必需): 组织ID

**请求体**:
```json
{
  "productKey": "ploml",
  "tier": "trial"
}
```

**请求参数**:
- `productKey` (string, 必需): 产品标识符
- `tier` (string, 可选): 试用级别，默认"trial"

**成功响应** (201):
```json
{
  "success": true,
  "data": {
    "subscription": {
      "id": "sub-trial123",
      "organizationId": "org-abc123",
      "productKey": "ploml",
      "tier": "trial",
      "status": "TRIALING",
      "trialEnd": "2024-02-15T00:00:00Z",
      "gracePeriodEnd": "2024-02-15T00:00:00Z",
      "createdAt": "2024-01-15T10:30:00Z"
    },
    "features": {
      "api_requests": {
        "limit": 1000,
        "unit": "requests/month"
      }
    }
  }
}
```

**失败响应**:
- **409 Conflict**: 已使用过试用
```json
{
  "success": false,
  "error": {
    "code": "trial_already_used",
    "message": "此组织已使用过试用"
  }
}
```

- **409 Conflict**: 已有活跃订阅
```json
{
  "success": false,
  "error": {
    "code": "active_subscription_exists",
    "message": "组织已有活跃的订阅"
  }
}
```

**调用逻辑**:
1. 验证用户对组织的管理权限
2. 检查组织是否已使用过试用
3. 检查是否已有活跃订阅
4. 创建试用订阅记录
5. 更新组织的试用使用标记
6. 记录审计日志

**业务场景**:
- 新用户首次体验产品
- 产品试用申请
- 免费层体验

**数据库操作**:
- 创建: `Subscription`
- 更新: `Organization.hasUsedTrial = true`
- 创建: `AuditLog`

---

#### POST /api/subscription-service/v1/frontend/organizations/{organizationId}/subscriptions/checkout {#frontend-checkout}

**功能**: 创建付费订阅的Stripe Checkout会话
**调用方**: 前端应用
**认证**: JWT Token (必需)

**URL格式**:
```
POST /api/subscription-service/v1/frontend/organizations/{organizationId}/subscriptions/checkout
```

**路径参数**:
- `organizationId` (string, 必需): 组织ID

**请求体**:
```json
{
  "productKey": "ploml",
  "targetTier": "basic",
  "targetBillingCycle": "monthly",
  "region": "US",
  "successUrl": "https://app.tymoe.com/success",
  "cancelUrl": "https://app.tymoe.com/cancel"
}
```

**请求参数**:
- `productKey` (string, 必需): 产品标识符
- `targetTier` (string, 必需): 目标订阅级别
- `targetBillingCycle` (string, 必需): 账单周期 (monthly|annual)
- `region` (string, 可选): 地区代码，默认US
- `successUrl` (string, 必需): 支付成功后的重定向URL
- `cancelUrl` (string, 必需): 支付取消后的重定向URL

**成功响应** (200):
```json
{
  "success": true,
  "data": {
    "checkoutSessionId": "cs_stripe123",
    "checkoutUrl": "https://checkout.stripe.com/pay/cs_stripe123",
    "intentId": "intent-abc123",
    "priceInfo": {
      "amount": 2900,
      "currency": "USD",
      "interval": "month",
      "stripePriceId": "price_basic_monthly_us"
    }
  }
}
```

**失败响应**:
- **400 Bad Request**: 无效的tier或billing cycle
```json
{
  "success": false,
  "error": {
    "code": "invalid_pricing",
    "message": "指定的tier和billing cycle组合不存在"
  }
}
```

- **409 Conflict**: 已有活跃的付费订阅
```json
{
  "success": false,
  "error": {
    "code": "active_subscription_exists",
    "message": "组织已有活跃的付费订阅，请先取消现有订阅"
  }
}
```

**调用逻辑**:
1. 验证用户对组织的管理权限
2. 检查是否已有活跃的付费订阅
3. 根据地区和参数查询价格信息
4. 创建SubscriptionIntent记录
5. 创建Stripe Checkout Session
6. 返回checkout URL和intent ID

**业务场景**:
- 试用转付费订阅
- 新用户直接购买
- 订阅升级支付

**数据库操作**:
- 创建: `SubscriptionIntent`
- 查询: `Price`, `Organization`
- 创建: `AuditLog`

**Stripe集成**:
- 调用 `stripe.checkout.sessions.create()`
- 设置webhook回调处理支付结果
- 包含metadata用于后续订阅创建

---

#### POST /api/subscription-service/v1/frontend/organizations/{organizationId}/subscriptions/upgrade {#frontend-upgrade}

**功能**: 升级现有订阅
**调用方**: 前端应用
**认证**: JWT Token (必需)

**URL格式**:
```
POST /api/subscription-service/v1/frontend/organizations/{organizationId}/subscriptions/upgrade
```

**路径参数**:
- `organizationId` (string, 必需): 组织ID

**请求体**:
```json
{
  "targetTier": "standard",
  "targetBillingCycle": "annual",
  "region": "US",
  "successUrl": "https://app.tymoe.com/upgrade-success",
  "cancelUrl": "https://app.tymoe.com/upgrade-cancel"
}
```

**请求参数**:
- `targetTier` (string, 必需): 目标订阅级别
- `targetBillingCycle` (string, 必需): 目标账单周期
- `region` (string, 可选): 地区代码
- `successUrl` (string, 必需): 升级成功重定向URL
- `cancelUrl` (string, 必需): 升级取消重定向URL

**成功响应** (200):
```json
{
  "success": true,
  "data": {
    "upgradeType": "immediate",
    "checkoutSessionId": "cs_upgrade123",
    "checkoutUrl": "https://checkout.stripe.com/pay/cs_upgrade123",
    "intentId": "intent-upgrade123",
    "priceDifference": {
      "proratedAmount": 1200,
      "currency": "USD",
      "description": "Prorated upgrade from basic to standard"
    },
    "newFeatures": {
      "api_requests": {
        "currentLimit": 10000,
        "newLimit": 50000
      }
    }
  }
}
```

**失败响应**:
- **400 Bad Request**: 无效的升级路径
```json
{
  "success": false,
  "error": {
    "code": "invalid_upgrade",
    "message": "无法从standard降级到basic"
  }
}
```

- **404 Not Found**: 无活跃订阅
```json
{
  "success": false,
  "error": {
    "code": "no_active_subscription",
    "message": "组织没有可升级的活跃订阅"
  }
}
```

**调用逻辑**:
1. 获取当前活跃订阅
2. 验证升级路径的有效性（不允许降级）
3. 计算按比例分配的价格差异
4. 创建升级Intent记录
5. 创建Stripe Checkout Session
6. 返回升级信息和支付链接

**业务场景**:
- 订阅计划升级
- 使用量超限时的升级
- 功能需求增长时的升级

**升级策略**:
- 即时升级: 立即生效，按比例计费
- 周期末升级: 在当前周期结束时生效

---

#### POST /api/subscription-service/v1/frontend/organizations/{organizationId}/subscriptions/cancel {#frontend-cancel}

**功能**: 取消订阅
**调用方**: 前端应用
**认证**: JWT Token (必需)

**URL格式**:
```
POST /api/subscription-service/v1/frontend/organizations/{organizationId}/subscriptions/cancel
```

**路径参数**:
- `organizationId` (string, 必需): 组织ID

**请求体**:
```json
{
  "cancelImmediately": false,
  "reason": "cost_concerns",
  "feedback": "服务价格超出预算"
}
```

**请求参数**:
- `cancelImmediately` (boolean, 可选): 是否立即取消，默认false
- `reason` (string, 可选): 取消原因代码
- `feedback` (string, 可选): 用户反馈

**成功响应** (200):
```json
{
  "success": true,
  "data": {
    "subscription": {
      "id": "sub-xyz789",
      "status": "CANCELED",
      "cancelAtPeriodEnd": true,
      "currentPeriodEnd": "2024-02-01T00:00:00Z",
      "gracePeriodEnd": "2024-02-08T00:00:00Z",
      "canceledAt": "2024-01-15T10:30:00Z"
    },
    "accessInfo": {
      "serviceUntil": "2024-02-08T00:00:00Z",
      "remainingDays": 24,
      "message": "您的服务将在2024年2月8日到期"
    }
  }
}
```

**失败响应**:
- **404 Not Found**: 无活跃订阅
```json
{
  "success": false,
  "error": {
    "code": "no_active_subscription",
    "message": "没有可取消的活跃订阅"
  }
}
```

**调用逻辑**:
1. 获取当前活跃订阅
2. 根据取消类型处理:
   - 立即取消: 更新状态为CANCELED，设置gracePeriodEnd
   - 周期末取消: 设置cancelAtPeriodEnd标记
3. 调用Stripe API取消订阅
4. 记录取消原因和反馈
5. 发送取消确认邮件

**业务场景**:
- 用户主动取消订阅
- 成本控制需求
- 服务不满意
- 业务需求变更

**取消策略**:
- 标准取消: 在当前计费周期结束时生效，保留宽限期
- 立即取消: 立即生效，但保留短期宽限期

---

### 🔧 内部订阅API (Internal Subscription APIs)

这类API为内部微服务提供订阅查询和管理功能，用于服务间的订阅状态检查和权限验证。

#### POST /api/subscription-service/v1/subscriptions/trial {#internal-subscriptions-trial}

**功能**: 创建试用订阅（内部服务调用）
**调用方**: 内部微服务
**认证**: JWT Token (必需)

**URL格式**:
```
POST /api/subscription-service/v1/subscriptions/trial
```

**请求体**:
```json
{
  "organizationId": "org-abc123",
  "productKey": "ploml",
  "tier": "trial",
  "trialDays": 30
}
```

**请求参数**:
- `organizationId` (string, 必需): 组织ID
- `productKey` (string, 必需): 产品标识符
- `tier` (string, 可选): 试用级别，默认"trial"
- `trialDays` (number, 可选): 试用天数，默认30天

**成功响应** (201):
```json
{
  "success": true,
  "data": {
    "subscription": {
      "id": "sub-trial456",
      "organizationId": "org-abc123",
      "productKey": "ploml",
      "tier": "trial",
      "status": "TRIALING",
      "trialEnd": "2024-02-15T00:00:00Z",
      "gracePeriodEnd": "2024-02-15T00:00:00Z",
      "createdAt": "2024-01-15T10:30:00Z"
    }
  }
}
```

**调用逻辑**:
1. 验证组织存在性
2. 检查组织试用使用状态
3. 计算试用结束时间
4. 创建试用订阅记录
5. 更新组织试用标记
6. 记录审计日志

**业务场景**:
- 自动化试用开通
- 批量用户试用创建
- 系统集成触发的试用

---

#### POST /api/subscription-service/v1/subscriptions/paid {#internal-subscriptions-paid}

**功能**: 创建付费订阅（内部服务调用）
**调用方**: 内部微服务
**认证**: JWT Token (必需)

**URL格式**:
```
POST /api/subscription-service/v1/subscriptions/paid
```

**请求体**:
```json
{
  "organizationId": "org-abc123",
  "productKey": "ploml",
  "tier": "basic",
  "billingCycle": "monthly",
  "stripeSubscriptionId": "sub_stripe123",
  "stripePriceId": "price_basic_monthly",
  "currentPeriodStart": "2024-01-15T00:00:00Z",
  "currentPeriodEnd": "2024-02-15T00:00:00Z"
}
```

**请求参数**:
- `organizationId` (string, 必需): 组织ID
- `productKey` (string, 必需): 产品标识符
- `tier` (string, 必需): 订阅级别
- `billingCycle` (string, 必需): 账单周期
- `stripeSubscriptionId` (string, 必需): Stripe订阅ID
- `stripePriceId` (string, 必需): Stripe价格ID
- `currentPeriodStart` (string, 必需): 当前周期开始时间
- `currentPeriodEnd` (string, 必需): 当前周期结束时间

**成功响应** (201):
```json
{
  "success": true,
  "data": {
    "subscription": {
      "id": "sub-paid789",
      "organizationId": "org-abc123",
      "productKey": "ploml",
      "tier": "basic",
      "status": "ACTIVE",
      "billingCycle": "monthly",
      "currentPeriodStart": "2024-01-15T00:00:00Z",
      "currentPeriodEnd": "2024-02-15T00:00:00Z",
      "gracePeriodEnd": "2024-02-22T00:00:00Z",
      "stripeSubscriptionId": "sub_stripe123",
      "stripePriceId": "price_basic_monthly",
      "createdAt": "2024-01-15T10:30:00Z"
    }
  }
}
```

**调用逻辑**:
1. 验证Stripe订阅ID的有效性
2. 检查组织是否已有活跃订阅
3. 计算宽限期结束时间（周期结束+7天）
4. 创建付费订阅记录
5. 如果存在试用订阅，则标记为替换
6. 记录审计日志

**业务场景**:
- Webhook处理支付成功事件
- 管理员手动创建订阅
- 数据迁移和同步

**重要说明**:
这个API主要用于Webhook处理和管理员操作，不应在常规业务流程中直接调用。

---

#### GET /api/subscription-service/v1/subscriptions/{subscriptionId} {#internal-subscriptions-get}

**功能**: 获取订阅详情
**调用方**: 内部微服务
**认证**: JWT Token (必需)

**URL格式**:
```
GET /api/subscription-service/v1/subscriptions/{subscriptionId}
```

**路径参数**:
- `subscriptionId` (string, 必需): 订阅ID

**成功响应** (200):
```json
{
  "success": true,
  "data": {
    "subscription": {
      "id": "sub-xyz789",
      "organizationId": "org-abc123",
      "productKey": "ploml",
      "tier": "basic",
      "status": "ACTIVE",
      "billingCycle": "monthly",
      "currentPeriodStart": "2024-01-15T00:00:00Z",
      "currentPeriodEnd": "2024-02-15T00:00:00Z",
      "gracePeriodEnd": "2024-02-22T00:00:00Z",
      "stripeSubscriptionId": "sub_stripe123",
      "cancelAtPeriodEnd": false,
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-15T10:30:00Z"
    },
    "organization": {
      "id": "org-abc123",
      "name": "My Company"
    },
    "features": {
      "api_requests": {
        "isEnabled": true,
        "limit": 10000,
        "unit": "requests/month"
      }
    }
  }
}
```

**调用逻辑**:
1. 验证订阅ID的有效性
2. 查询订阅详细信息
3. 加载关联的组织信息
4. 基于tier查询功能权限
5. 构建完整的订阅视图

**业务场景**:
- 微服务间的订阅状态查询
- 权限验证时的订阅信息获取
- 系统监控和报告

---

### 🔍 微服务权限API (Microservice Permission APIs)

这类API为内部微服务提供实时权限检查、使用量统计和访问控制功能。

#### POST /api/subscription-service/v1/microservices/check-permission {#microservices-check-permission}

**功能**: 批量权限检查
**调用方**: 内部微服务
**认证**: JWT Token (必需)

**URL格式**:
```
POST /api/subscription-service/v1/microservices/check-permission
```

**请求体**:
```json
{
  "checks": [
    {
      "organizationId": "org-abc123",
      "serviceKey": "api-gateway",
      "featureKey": "api_requests",
      "requestCount": 1
    }
  ]
}
```

**成功响应** (200):
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "organizationId": "org-abc123",
        "serviceKey": "api-gateway",
        "featureKey": "api_requests",
        "allowed": true,
        "reason": null,
        "usage": {
          "current": 3420,
          "limit": 10000,
          "remaining": 6580
        }
      }
    ]
  }
}
```

**调用逻辑**:
1. 并行处理多个权限检查请求
2. 为每个请求查询组织订阅状态
3. 检查功能可用性和使用限制
4. 汇总所有检查结果
5. 返回批量检查报告

**业务场景**:
- API网关的批量权限验证
- 微服务启动时的权限预加载
- 复合操作的权限检查

---

#### POST /api/subscription-service/v1/usage/record {#usage-record}

**功能**: 记录使用量
**调用方**: 内部微服务
**认证**: JWT Token (必需)

**URL格式**:
```
POST /api/subscription-service/v1/usage/record
```

**请求体**:
```json
{
  "records": [
    {
      "organizationId": "org-abc123",
      "serviceKey": "api-gateway",
      "featureKey": "api_requests",
      "count": 5,
      "timestamp": "2024-01-15T10:30:00Z",
      "metadata": {
        "endpoint": "/api/v1/chat",
        "method": "POST"
      }
    }
  ]
}
```

**成功响应** (201):
```json
{
  "success": true,
  "data": {
    "recordedCount": 1,
    "summary": {
      "organizationId": "org-abc123",
      "totalCount": 5,
      "currentPeriodUsage": 3425
    }
  }
}
```

**调用逻辑**:
1. 验证所有记录的有效性
2. 批量插入使用量记录
3. 更新实时使用量缓存
4. 检查是否接近限制阈值
5. 触发告警（如需要）

**业务场景**:
- 微服务的使用量上报
- 实时计费数据收集
- 容量监控数据源

---

### 🔗 Webhook API (Stripe Event Handling)

Stripe Webhook事件处理API，用于同步支付状态和订阅变更。

#### POST /api/subscription-service/v1/webhooks/stripe {#webhooks-stripe}

**功能**: 处理Stripe Webhook事件
**调用方**: Stripe服务
**认证**: Stripe签名验证

**URL格式**:
```
POST /api/subscription-service/v1/webhooks/stripe
```

**请求头**:
```
Stripe-Signature: t=1234567890,v1=signature_hash
Content-Type: application/json
```

**支持的事件类型**:
- `checkout.session.completed` - 支付会话完成
- `customer.subscription.created` - 订阅创建
- `customer.subscription.updated` - 订阅更新
- `customer.subscription.deleted` - 订阅删除
- `invoice.payment_succeeded` - 发票支付成功
- `invoice.payment_failed` - 发票支付失败

**成功响应** (200):
```json
{
  "received": true,
  "eventId": "evt_1234567890",
  "processed": true
}
```

**调用逻辑**:
1. 验证Stripe签名的有效性
2. 检查事件是否已处理（幂等性）
3. 根据事件类型路由到相应处理器
4. 更新本地订阅状态
5. 完成Intent状态更新
6. 记录处理结果和审计日志

**事件处理流程**:

**checkout.session.completed**:
1. 提取session metadata中的intentId
2. 查找对应的SubscriptionIntent
3. 获取订阅详情并创建/更新本地订阅记录
4. 标记Intent为completed

**customer.subscription.updated**:
1. 根据Stripe subscription ID查找本地订阅
2. 同步订阅状态、周期、价格等信息
3. 更新宽限期设置
4. 清理权限缓存

**invoice.payment_failed**:
1. 查找相关订阅
2. 设置宽限期（7天）
3. 发送支付失败通知
4. 记录支付失败原因

**安全特性**:
- Stripe签名验证防止伪造请求
- 事件幂等性处理防止重复执行
- 超时和重试机制确保可靠性
- 详细的错误日志便于调试

**业务场景**:
- 支付成功后的订阅激活
- 订阅变更的状态同步
- 支付失败的处理和通知
- 订阅取消的处理

---

### 🛡️ 管理员API (Admin APIs)

管理员API用于运维操作、数据修复和系统管理，需要特殊的API Key认证。

#### POST /api/subscription-service/v1/admin/organizations {#admin-organizations-create}

**功能**: 强制创建组织（管理员专用）
**调用方**: 运维工具
**认证**: API Key (必需)

**URL格式**:
```
POST /api/subscription-service/v1/admin/organizations
```

**请求头**:
```
X-API-Key: {internal_api_key}
Content-Type: application/json
```

**请求体**:
```json
{
  "name": "Emergency Organization",
  "region": "US",
  "hasUsedTrial": false,
  "reason": "Customer support request",
  "ticketId": "SUPPORT-12345"
}
```

**成功响应** (201):
```json
{
  "success": true,
  "data": {
    "organization": {
      "id": "org-admin123",
      "name": "Emergency Organization",
      "hasUsedTrial": false,
      "stripeCustomerId": "cus_admin123",
      "createdAt": "2024-01-15T10:30:00Z"
    },
    "auditLog": {
      "id": "audit-456",
      "action": "CREATE",
      "actorType": "ADMIN",
      "reason": "Customer support request",
      "ticketId": "SUPPORT-12345"
    }
  }
}
```

**调用逻辑**:
1. 验证API Key权限
2. 创建Stripe Customer记录
3. 在数据库中创建Organization
4. 记录详细的审计日志
5. 发送创建成功通知

**业务场景**:
- 客户支持紧急请求
- 数据迁移和修复
- 特殊业务需求

**审计要求**:
- 所有Admin API调用必须提供reason
- 建议提供ticketId用于追踪
- 操作记录自动写入AuditLog

---

#### POST /api/subscription-service/v1/admin/subscriptions {#admin-subscriptions-create}

**功能**: 强制创建订阅（管理员专用）
**调用方**: 运维工具
**认证**: API Key + 维护模式

**重要警告**: 此API默认禁用，需要设置环境变量 `ADMIN_MAINTENANCE_MODE=true` 才能使用。

**URL格式**:
```
POST /api/subscription-service/v1/admin/subscriptions
```

**请求体**:
```json
{
  "organizationId": "org-abc123",
  "productKey": "ploml",
  "tier": "basic",
  "status": "ACTIVE",
  "billingCycle": "monthly",
  "currentPeriodStart": "2024-01-15T00:00:00Z",
  "currentPeriodEnd": "2024-02-15T00:00:00Z",
  "stripeSubscriptionId": "sub_emergency123",
  "reason": "Emergency subscription restoration",
  "ticketId": "INCIDENT-789"
}
```

**成功响应** (201):
```json
{
  "success": true,
  "data": {
    "subscription": {
      "id": "sub-admin456",
      "organizationId": "org-abc123",
      "productKey": "ploml",
      "tier": "basic",
      "status": "ACTIVE",
      "gracePeriodEnd": "2024-02-22T00:00:00Z",
      "createdAt": "2024-01-15T10:40:00Z"
    }
  }
}
```

**调用逻辑**:
1. 检查维护模式是否启用
2. 验证所有必需参数
3. 检查是否存在冲突的订阅
4. 创建订阅记录
5. 计算宽限期
6. 记录创建审计日志

**业务场景**:
- 紧急服务恢复
- 支付系统故障后的手动修复
- 数据迁移

**安全控制**:
- 需要设置 `ADMIN_MAINTENANCE_MODE=true`
- 所有操作记录审计日志
- 必须提供reason和ticketId

---

#### PATCH /api/subscription-service/v1/admin/subscriptions/{subscriptionId}/status {#admin-subscriptions-update-status}

**功能**: 强制更新订阅状态
**调用方**: 运维工具
**认证**: API Key (必需)

**URL格式**:
```
PATCH /api/subscription-service/v1/admin/subscriptions/{subscriptionId}/status
```

**请求体**:
```json
{
  "status": "ACTIVE",
  "gracePeriodEnd": "2024-02-22T00:00:00Z",
  "reason": "Restore service after payment issue resolved",
  "ticketId": "SUPPORT-12347"
}
```

**成功响应** (200):
```json
{
  "success": true,
  "data": {
    "subscription": {
      "id": "sub-xyz789",
      "status": "ACTIVE",
      "gracePeriodEnd": "2024-02-22T00:00:00Z",
      "updatedAt": "2024-01-15T10:45:00Z"
    },
    "changes": {
      "status": {
        "from": "CANCELED",
        "to": "ACTIVE"
      }
    }
  }
}
```

**调用逻辑**:
1. 验证订阅存在性
2. 记录状态变更前的值
3. 应用状态更新
4. 清理相关权限缓存
5. 记录状态变更审计日志

**业务场景**:
- 支付问题解决后恢复服务
- 误操作的状态修正
- 系统故障后的数据修复

---

**文档维护**: 本手册应随系统更新及时维护，建议每月review一次。

**联系方式**: 如需技术支持或有改进建议，请联系开发团队。