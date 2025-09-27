# Tymoe Subscription Service - 技术白皮书

> **企业级订阅管理服务** - 基于Stripe Webhook SSOT架构的完整订阅生命周期管理系统

## 🏗️ 系统架构概览

### 核心设计原则

本服务采用**Webhook驱动的单一真相来源（SSOT）**架构模式：

1. **Stripe作为SSOT**: 所有订阅状态变更必须通过Stripe Webhook确认
2. **Intent-based操作**: 防止竞态条件，所有付费操作先创建Intent，Webhook完成后更新状态
3. **完整审计追踪**: 记录所有系统操作，支持合规和问题排查
4. **本地Trial管理**: 试用订阅本地管理，每个组织限用一次
5. **严格权限控制**: Admin操作需要维护模式+API密钥+审计要求

### 订阅状态机（修正版）

```
TRIALING ────→ ACTIVE ────→ CANCELED ────→ EXPIRED
    │              │               │
    │              │               └─→ REACTIVATED ──┐
    │              │                                  │
    │              └─→ UPGRADED ────────────────────→ │
    │                                                 │
    └─────────────────────────────────────────────────┘
```

**状态说明**:
- `TRIALING`: 试用期，本地管理，gracePeriodEnd = trialEnd
- `ACTIVE`: 付费激活，Stripe管理，gracePeriodEnd = currentPeriodEnd + 7天
- `CANCELED`: 已取消，gracePeriodEnd内仍可使用
- `EXPIRED`: 完全过期，功能停用
- `UPGRADED`: 升级操作中的临时状态
- `REACTIVATED`: 重新激活

**宽限期逻辑**: 通过`gracePeriodEnd`字段实现，无需单独PAST_DUE状态。

### 数据库协作关系深度解析

#### 实体关系设计原则

我们的数据模型基于**领域驱动设计(DDD)**原则，清晰地分离了不同的业务边界：

**核心业务实体**:
- `Organization`: 组织聚合根，管理客户实体
- `Subscription`: 订阅聚合根，管理订阅生命周期
- `Product/Level/Feature`: 产品目录聚合，管理功能权限

**支撑业务实体**:
- `Price`: 定价策略，支持多地区多货币
- `SubscriptionIntent`: 操作意图，实现乐观锁和幂等性
- `AuditLog`: 审计追踪，满足合规要求

#### 数据流动模式图

```mermaid
graph TD
    A[用户操作] --> B[创建Intent]
    B --> C[Stripe Checkout]
    C --> D[Webhook事件]
    D --> E[更新Subscription]
    E --> F[同步Entitlement]
    F --> G[刷新权限缓存]

    H[微服务请求] --> I[权限检查]
    I --> J[订阅状态验证]
    J --> K[功能限制检查]
    K --> L[使用量统计]
    L --> M[返回权限结果]
```

#### 关键数据流详解

**1. 订阅创建流程数据流**:
```
用户请求 → SubscriptionIntent(创建) → Stripe API调用
→ Webhook接收 → Subscription(创建/更新) → AuditLog(记录)
→ 权限缓存(刷新) → 组织权限(更新)
```

**2. 权限验证流程数据流**:
```
API请求 → Organization(查询) → Subscription(验证状态)
→ Entitlement(查询权限) → Feature(检查限制)
→ MicroserviceUsage(记录使用) → 权限结果(返回)
```

**3. 使用量统计流程数据流**:
```
微服务调用 → MicroserviceUsage(记录) → 实时聚合计算
→ 限制检查 → 告警触发(可选) → 统计报告(生成)
```

#### 数据一致性保证机制

**乐观锁控制**:
- `SubscriptionIntent.version`: 防止并发Intent更新冲突
- 基于版本号的更新机制确保数据完整性

**事务边界设计**:
```typescript
// 订阅创建的事务边界示例
await prisma.$transaction(async (tx) => {
  // 1. 更新Intent状态(带版本控制)
  await tx.subscriptionIntent.update({
    where: { id: intentId, version: currentVersion },
    data: { status: 'completed', version: currentVersion + 1 }
  });

  // 2. 创建/更新订阅
  await tx.subscription.upsert({
    where: { organizationId_productKey: { organizationId, productKey } },
    create: subscriptionData,
    update: subscriptionData
  });

  // 3. 记录审计日志
  await tx.auditLog.create({ data: auditData });
});
```

**数据同步策略**:
- **最终一致性**: Webhook处理采用最终一致性模型
- **补偿机制**: 失败的Webhook事件支持重试和手动修复
- **数据校验**: 定期运行数据一致性检查任务

#### 性能优化索引策略

```sql
-- 高频查询的复合索引
CREATE INDEX idx_subscription_org_product_status
ON Subscription(organizationId, productKey, status, gracePeriodEnd);

-- 权限查询优化索引
CREATE INDEX idx_entitlement_level_feature
ON Entitlement(productKey, tier, featureKey, isEnabled);

-- 使用量统计索引
CREATE INDEX idx_usage_org_service_period
ON MicroserviceUsage(organizationId, serviceKey, usagePeriod, createdAt);

-- 审计查询索引
CREATE INDEX idx_audit_entity_timestamp
ON AuditLog(entityType, entityId, timestamp DESC);
```

#### 缓存策略和数据访问模式

**权限信息缓存**:
- **TTL**: 10分钟权限缓存
- **键模式**: `org:{organizationId}:permissions`
- **失效策略**: 订阅状态变更时主动清理

**使用量热数据**:
- **实时计数**: Redis Hash存储当前计费周期使用量
- **批量写入**: 异步批量写入持久化存储
- **限流检查**: 基于缓存数据进行实时限流判断

## 📁 项目结构

```
/src
  /config
    env.ts                     # 环境变量配置和验证
    features.ts                # 功能权限配置
  /infra
    prisma.ts                  # Prisma客户端
    stripe.ts                  # Stripe客户端
    redis.ts                   # Redis缓存客户端
  /middleware
    auth.ts                    # JWKS JWT验证 + 内部API Key验证
    errorHandler.ts            # 全局错误处理
    rateLimit.ts              # 频率限制
  /controllers
    frontend.ts               # 前端用户API控制器
    organization.controller.ts # 组织管理API控制器
    subscription.controller.ts # 订阅管理API控制器
    webhook.controller.ts     # Stripe Webhook处理控制器
    microserviceUsage.controller.ts # 使用量记录API控制器
    admin.controller.ts       # 管理员API控制器
  /routes
    frontend.ts               # 前端用户路由
    organization.ts           # 组织路由
    subscription.ts           # 订阅路由
    webhook.ts                # Webhook路由
    microserviceUsage.ts      # 使用量路由
    admin.ts                  # 管理员路由
  /services
    subscriptionIntent.service.ts   # Intent审计表服务
    subscription.service.ts         # 订阅业务逻辑
    organization.service.ts         # 组织管理逻辑
    microservicePermission.service.ts # 权限检查服务
    stripeWebhook.service.ts        # Webhook处理服务
  /utils
    logger.ts                 # 结构化日志
    cache.ts                  # 缓存工具
    validation.ts             # 输入验证
  /types
    index.ts                  # TypeScript类型定义
```

## 🗄️ 数据库架构

### 核心表关系图

```mermaid
erDiagram
    Organization ||--o{ Subscription : has
    Organization ||--o{ AuditLog : generates

    Subscription }o--|| Product : belongs_to
    Subscription ||--o{ SubscriptionIntent : has
    Subscription ||--o{ AuditLog : generates

    Product ||--o{ Level : has
    Level ||--o{ Entitlement : includes
    Entitlement }o--|| Feature : grants

    Product ||--o{ Price : has
    Price }o--|| Level : for

    SubscriptionIntent ||--o{ AuditLog : generates

    MicroserviceUsage }o--|| Organization : tracks
    MicroserviceUsage }o--|| Subscription : under

    Organization {
        string id PK
        string name
        string stripe_customer_id
        boolean has_used_trial
        datetime created_at
        datetime updated_at
    }

    Subscription {
        string id PK
        string organization_id FK
        string product_key
        string tier
        string status
        string billing_cycle
        datetime current_period_start
        datetime current_period_end
        datetime trial_end
        datetime grace_period_end
        string stripe_subscription_id
        string stripe_price_id
        boolean cancel_at_period_end
        datetime created_at
        datetime updated_at
    }

    Product {
        string key PK
        string name
        string description
        boolean active
        datetime created_at
        datetime updated_at
    }

    Level {
        string id PK
        string product_key FK
        string tier
        string name
        int order
        boolean active
        datetime created_at
        datetime updated_at
    }

    Price {
        string id PK
        string stripe_price_id
        string product_key FK
        string tier
        string billing_cycle
        int amount
        string currency
        string region
        boolean active
        datetime created_at
        datetime updated_at
    }

    Feature {
        string key PK
        string name
        string description
        string type
        json config
        boolean active
        datetime created_at
        datetime updated_at
    }

    Entitlement {
        string id PK
        string product_key FK
        string tier FK
        string feature_key FK
        json limits
        boolean active
        datetime created_at
        datetime updated_at
    }

    SubscriptionIntent {
        string id PK
        string organization_id FK
        string product_key
        string action
        string status
        string stripe_price_id
        json metadata
        datetime expires_at
        datetime created_at
        datetime updated_at
    }

    AuditLog {
        string id PK
        string organization_id FK
        string subscription_id FK
        string action
        string actor
        json old_values
        json new_values
        string reason
        datetime created_at
    }

    MicroserviceUsage {
        string id PK
        string organization_id FK
        string subscription_id FK
        string service_key
        string usage_period
        string period_type
        int request_count
        datetime created_at
        datetime updated_at
    }
```

### 价格表唯一索引（修正版）

```sql
-- 修正后的价格表约束，包含currency字段
@@unique([productKey, tier, billingCycle, region, currency])
```

这确保了多币种场景下的唯一性约束正确性。

## 🌐 API路由架构

### 基础信息

**服务基础URL**: `http://localhost:8088` (开发环境)
**API版本化路径**: `/api/subscription-service/v1`
**完整基础路径**: `http://localhost:8088/api/subscription-service/v1`

### API分类体系

| API类型 | 路径前缀 | 调用方 | 认证方式 | 用途描述 |
|---------|----------|--------|----------|----------|
| 🎯 **前端用户API** | `/frontend/*` | 前端应用 | JWT Token | 用户直接操作：组织管理、订阅购买、试用申请 |
| 🔧 **内部订阅API** | `/subscriptions/*`, `/organizations/*` | 内部微服务 | JWT Token | 服务间查询：订阅状态、组织信息、权限验证 |
| 🔍 **微服务权限API** | `/microservices/*`, `/usage/*` | 内部微服务 | JWT Token | 实时检查：权限验证、使用统计、配额管理 |
| 🔗 **Webhook API** | `/webhooks/*` | Stripe服务 | Stripe签名 | 状态同步：支付成功、订阅变更、发票事件 |
| 🛡️ **管理员API** | `/admin/*` | 运维工具 | API Key | 运维管理：数据修复、状态强制同步、审计查询 |

## 📖 详细API文档索引

> 每个路由的完整技术规格请参阅 [INTERNAL_MANUAL.md](./INTERNAL_MANUAL.md)

### 🎯 前端用户API
- [`GET /frontend/user/organizations-overview`](./INTERNAL_MANUAL.md#frontend-user-organizations-overview) - 获取用户组织概览
- [`POST /frontend/user/organizations`](./INTERNAL_MANUAL.md#frontend-user-organizations-create) - 创建新组织
- [`GET /frontend/products/{productKey}/pricing`](./INTERNAL_MANUAL.md#frontend-products-pricing) - 获取产品定价
- [`GET /frontend/products/{productKey}/features`](./INTERNAL_MANUAL.md#frontend-products-features) - 获取产品功能列表
- [`GET /frontend/organizations/{organizationId}/subscription-status`](./INTERNAL_MANUAL.md#frontend-subscription-status) - 查询订阅状态
- [`GET /frontend/organizations/{organizationId}/products/{productKey}/features/{featureKey}/access`](./INTERNAL_MANUAL.md#frontend-feature-access) - 检查功能访问权限
- [`POST /frontend/organizations/{organizationId}/subscriptions/start-trial`](./INTERNAL_MANUAL.md#frontend-start-trial) - 开始试用
- [`POST /frontend/organizations/{organizationId}/subscriptions/checkout`](./INTERNAL_MANUAL.md#frontend-checkout) - 创建付费订阅
- [`POST /frontend/organizations/{organizationId}/subscriptions/upgrade`](./INTERNAL_MANUAL.md#frontend-upgrade) - 升级订阅
- [`POST /frontend/organizations/{organizationId}/subscriptions/cancel`](./INTERNAL_MANUAL.md#frontend-cancel) - 取消订阅

### 🔧 内部订阅API
- [`POST /subscriptions/trial`](./INTERNAL_MANUAL.md#internal-subscriptions-trial) - 创建试用订阅
- [`POST /subscriptions/paid`](./INTERNAL_MANUAL.md#internal-subscriptions-paid) - 创建付费订阅
- [`GET /subscriptions/{subscriptionId}`](./INTERNAL_MANUAL.md#internal-subscriptions-get) - 获取订阅详情
- [`GET /subscriptions/organization/{organizationId}/product/{productKey}`](./INTERNAL_MANUAL.md#internal-subscriptions-by-org-product) - 按组织和产品查询订阅
- [`GET /subscriptions/organization/{organizationId}`](./INTERNAL_MANUAL.md#internal-subscriptions-by-org) - 获取组织所有订阅
- [`GET /subscriptions/organization/{organizationId}/product/{productKey}/feature/{featureKey}`](./INTERNAL_MANUAL.md#internal-subscriptions-feature-access) - 检查功能访问权限
- [`GET /subscriptions/pricing/{productKey}`](./INTERNAL_MANUAL.md#internal-subscriptions-pricing) - 获取产品定价信息

### 🔍 微服务权限API
- [`POST /microservices/check-permission`](./INTERNAL_MANUAL.md#microservices-check-permission) - 批量权限检查
- [`GET /microservices/accessible/{organizationId}`](./INTERNAL_MANUAL.md#microservices-accessible) - 获取可访问服务列表
- [`GET /microservices/stats/{organizationId}`](./INTERNAL_MANUAL.md#microservices-stats) - 获取使用统计
- [`GET /microservices/usage/{organizationId}`](./INTERNAL_MANUAL.md#microservices-usage) - 获取使用详情
- [`POST /usage/record`](./INTERNAL_MANUAL.md#usage-record) - 记录使用量
- [`GET /usage/stats`](./INTERNAL_MANUAL.md#usage-stats) - 获取使用统计
- [`GET /usage/by-service`](./INTERNAL_MANUAL.md#usage-by-service) - 按服务获取使用情况
- [`GET /usage/trends`](./INTERNAL_MANUAL.md#usage-trends) - 获取使用趋势
- [`GET /usage/current/{serviceKey}`](./INTERNAL_MANUAL.md#usage-current) - 获取当前使用量

### 🔗 Webhook API
- [`POST /webhooks/stripe`](./INTERNAL_MANUAL.md#webhooks-stripe) - Stripe事件处理

### 🛡️ 管理员API
- [`POST /admin/organizations`](./INTERNAL_MANUAL.md#admin-organizations-create) - 强制创建组织
- [`GET /admin/organizations/{organizationId}`](./INTERNAL_MANUAL.md#admin-organizations-get) - 获取组织详情
- [`PATCH /admin/organizations/{organizationId}`](./INTERNAL_MANUAL.md#admin-organizations-update) - 更新组织信息
- [`POST /admin/subscriptions`](./INTERNAL_MANUAL.md#admin-subscriptions-create) - 强制创建订阅
- [`PATCH /admin/subscriptions/{subscriptionId}/status`](./INTERNAL_MANUAL.md#admin-subscriptions-update-status) - 强制更新订阅状态

## ⚙️ 环境配置

### 必需环境变量

```bash
# 数据库配置
DATABASE_URL=postgresql://postgres:password@localhost:5432/subscription_service

# Redis配置
REDIS_URL=redis://localhost:6379

# Stripe配置
STRIPE_SECRET_KEY=sk_test_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx

# JWT配置
JWKS_URI=https://tymoe.com/jwks.json

# 服务配置
PORT=8088
NODE_ENV=development

# 安全配置
INTERNAL_API_KEY=your-secure-internal-api-key
```

### 开发环境启动

```bash
# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑.env文件，填入正确的配置值

# 运行数据库迁移
npm run prisma:migrate:dev

# 启动开发服务器
npm run dev

# 健康检查
curl http://localhost:8088/health
```

### Stripe Webhook配置

```bash
# 开发环境Webhook监听
stripe listen --forward-to localhost:8088/api/subscription-service/v1/webhooks/stripe

# 生产环境Webhook端点
https://api.tymoe.com/api/subscription-service/v1/webhooks/stripe
```

## 🔐 认证和授权

### JWT认证（用户API）

```javascript
// 前端调用示例
const response = await fetch('/api/subscription-service/v1/frontend/user/organizations-overview', {
  headers: {
    'Authorization': `Bearer ${jwtToken}`,
    'Content-Type': 'application/json'
  }
});
```

### API Key认证（Admin API）

```bash
# Admin API调用示例
curl -X GET http://localhost:8088/api/subscription-service/v1/admin/organizations/org-123 \
  -H "X-API-Key: ${INTERNAL_API_KEY}" \
  -H "Content-Type: application/json"
```

### Stripe Webhook验证

Stripe Webhook使用签名验证机制，服务会自动验证`stripe-signature`头部。

## 📊 监控和日志

### 结构化日志

所有操作都会生成结构化日志，包含：
- 请求ID、用户ID、组织ID
- 操作类型、参数、结果
- 执行时间、错误信息

### 审计追踪

所有重要操作都会记录到`AuditLog`表：
- 订阅状态变更
- 权限修改
- Admin操作
- Webhook处理

### 性能指标

监控以下关键指标：
- API响应时间和错误率
- 数据库查询性能
- Redis缓存命中率
- Stripe API调用延迟

## 🚀 部署和扩展

### 容器化部署

```dockerfile
# Dockerfile示例
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 8088
CMD ["npm", "start"]
```

### 负载均衡考虑

- 无状态设计，支持水平扩展
- Redis用于共享缓存
- 数据库连接池配置

### 故障恢复

- 数据库主从复制
- Redis集群模式
- Webhook事件重试机制

## 📝 开发规范

### 代码风格

- TypeScript严格模式
- ESLint + Prettier配置
- 单元测试覆盖率 > 80%

### API设计原则

- RESTful设计
- 统一错误格式
- 版本化路径
- 完整的输入验证

### 数据库设计

- 严格的外键约束
- 软删除模式
- 创建/更新时间戳
- 索引优化

## 🔗 相关链接

- [INTERNAL_MANUAL.md](./INTERNAL_MANUAL.md) - 详细技术规格
- [Stripe API文档](https://stripe.com/docs/api)
- [Prisma文档](https://www.prisma.io/docs/)
- [JWT.io](https://jwt.io/)

---

**版本**: v2.0.0
**最后更新**: 2025-09-27
**维护团队**: Tymoe Engineering