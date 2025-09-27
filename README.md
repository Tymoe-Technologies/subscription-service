# Tymoe Subscription Service

> **企业级订阅管理服务** - 基于Stripe Webhook的SSOT架构，支持Intent-based操作和完整审计追踪

## 🏗️ 架构设计

本服务严格按照企业级微服务架构设计，采用**Webhook驱动的单一真相来源（SSOT）**模式：

### 核心设计原则

1. **Stripe作为SSOT**: 所有订阅状态变更必须通过Stripe Webhook确认，前端API仅创建Intent
2. **Intent-based操作**: 防止竞态条件，所有付费操作先创建Intent，Webhook完成后更新状态
3. **完整审计追踪**: 记录所有系统操作，支持合规和问题排查
4. **本地Trial管理**: 试用订阅本地管理，每个用户限用一次
5. **严格权限控制**: Admin操作需要维护模式+API密钥+审计要求

### 服务职责
- 订阅生命周期管理（Trial → Paid → Upgrade → Cancel）
- Stripe支付集成和Webhook处理
- Intent-based防竞态条件操作
- 完整的审计日志系统
- 组织和用户权限管理

## 📁 项目结构

```
/src
  /config
    env.ts                     # 环境变量配置和验证
  /infra
    prisma.ts                  # Prisma客户端
  /middleware
    auth.ts                    # JWKS JWT验证 + 内部API Key验证
    errorHandler.ts            # 全局错误处理
  /controllers
    organization.controller.ts # 组织管理API
    subscription.controller.ts # 订阅管理API (checkout/upgrade/cancel)
    webhook.controller.ts      # Stripe Webhook处理
    microserviceUsage.controller.ts # 使用量记录API
    admin.controller.ts        # 管理员API (高权限操作)
  /routes
    organization.controller.ts # 组织路由
    subscription.controller.ts # 订阅路由
    webhook.controller.ts      # Webhook路由
    microserviceUsage.controller.ts # 使用量路由
    admin.controller.ts        # 管理员路由
  /services
    subscriptionIntent.service.ts   # Intent审计表服务
    subscription.service.ts         # 订阅业务逻辑
    organization.service.ts         # 组织管理逻辑
    webhook.service.ts              # Webhook处理服务
    microserviceUsage.service.ts    # 使用量记录服务
    auditService.ts                 # 审计日志服务
  /types
    index.ts                   # 统一类型定义和常量
    subscription.ts            # 订阅相关类型定义
  /utils
    logger.ts                  # 结构化日志
    time.ts                    # 时间工具函数
  /routes
    organization.ts            # 组织路由
    subscription.ts            # 订阅路由
    intent.ts                  # Intent路由
    webhook.ts                 # Webhook路由
  index.ts                     # 服务入口
  app.ts                       # Express应用配置
```

## 🚀 快速开始

### 1. 环境配置

```bash
# 复制环境变量模板
cp .env.example .env
```

配置必要的环境变量：
```bash
# 服务配置
NODE_ENV=development
PORT=8088
LOG_LEVEL=info

# 数据库
DATABASE_URL=postgresql://postgres:password@localhost:5432/subscription_service

# Stripe配置
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# JWT验证
JWKS_URL=https://tymoe.com/jwks.json

# 安全配置
INTERNAL_API_KEY=your-secure-internal-api-key
ADMIN_MAINTENANCE_MODE=false

# Intent配置
INTENT_TTL_MINUTES=60
```

### 2. 安装依赖和数据库设置

```bash
# 安装依赖
npm install

# 运行数据库迁移
npx prisma migrate dev

# 生成Prisma客户端
npx prisma generate
```

### 3. 启动服务

```bash
# 开发模式（自动重载）
npm run dev

# 生产模式
npm run build
npm start

# 类型检查
npm run typecheck

# 代码检查
npm run lint
```

### 4. Stripe Webhook设置

```bash
# 安装Stripe CLI
brew install stripe/stripe-cli/stripe

# 启动Webhook监听
stripe listen --forward-to localhost:8088/api/subscription-service/v1/webhooks/stripe
```

### 5. 验证服务

```bash
# 健康检查
curl http://localhost:8088/health

# 预期响应
{
  "status": "ok",
  "service": "subscription-service",
  "version": "1.0.0",
  "timestamp": "2024-01-20T10:30:00Z"
}
```

## 🔧 环境变量详解

| 变量名 | 说明 | 默认值 | 必需 |
|--------|------|--------|------|
| `NODE_ENV` | 运行环境 | `development` | ✅ |
| `PORT` | 服务端口 | `8088` | ✅ |
| `DATABASE_URL` | PostgreSQL连接字符串 | - | ✅ |
| `STRIPE_SECRET_KEY` | Stripe密钥 | - | ✅ |
| `STRIPE_WEBHOOK_SECRET` | Stripe Webhook签名密钥 | - | ✅ |
| `JWKS_URL` | JWT公钥获取地址 | `https://tymoe.com/jwks.json` | ✅ |
| `INTERNAL_API_KEY` | 内部API密钥（Admin操作） | - | ✅ |
| `ADMIN_MAINTENANCE_MODE` | Admin维护模式开关 | `false` | ✅ |
| `INTENT_TTL_MINUTES` | Intent过期时间（分钟） | `60` | ✅ |
| `LOG_LEVEL` | 日志级别 | `info` | ✅ |
| `DEFAULT_REGION` | 默认地区 | `CA` | ✅ |
| `DEFAULT_CURRENCY` | 默认货币 | `CAD` | ✅ |
| `STRIPE_ACCOUNT_CA` | 加拿大Stripe账户密钥 | - | ❌ |
| `STRIPE_ACCOUNT_US` | 美国Stripe账户密钥 | - | ❌ |
| `STRIPE_ACCOUNT_EU` | 欧盟Stripe账户密钥 | - | ❌ |
| `STRIPE_ACCOUNT_GB` | 英国Stripe账户密钥 | - | ❌ |
| `STRIPE_ACCOUNT_AU` | 澳大利亚Stripe账户密钥 | - | ❌ |
| `STRIPE_SUCCESS_URL` | Stripe成功页面URL | `https://tymoe.com/success?session_id={CHECKOUT_SESSION_ID}` | ❌ |
| `STRIPE_CANCEL_URL` | Stripe取消页面URL | `https://tymoe.com/cancel` | ❌ |

## 🗄️ 数据库Schema

### 核心模型

```prisma
// 组织表
model Organization {
  id               String   @id
  userId           String   // auth-service用户ID
  name             String
  email            String?  // 用于计费
  stripeCustomerId String?  // 延迟创建
  hasUsedTrial     Boolean  @default(false)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  deletedAt        DateTime?

  subscriptions    Subscription[]
  intents          SubscriptionIntent[]
  usageRecords     UsageRecord[]
}

// 产品表
model Product {
  key         String @id     // ploml, mopai
  name        String         // 产品名称
  description String?        // 产品描述
  levelKey    String         // 关联Level的key (trial, basic, standard, advanced, pro)
  isActive    Boolean @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  level         Level          @relation(fields: [levelKey], references: [key])
  prices        Price[]
  subscriptions Subscription[]
}

// 级别表
model Level {
  key         String @id     // trial, basic, standard, advanced, pro
  name        String         // 级别名称
  description String?        // 级别描述
  sortOrder   Int            // 排序顺序
  isActive    Boolean @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  products     Product[]
  entitlements Entitlement[]
}

// 功能表
model Feature {
  key         String @id     // api_requests, storage_gb, team_members等
  name        String         // 功能名称
  description String?        // 功能描述
  dataType    String         // boolean, number
  unit        String?        // requests, gb, members等单位
  isActive    Boolean @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  entitlements Entitlement[]
}

// 权限配置表
model Entitlement {
  id        String @id @default(cuid())
  levelKey  String
  featureKey String

  // 对于boolean类型功能，使用isEnabled字段
  isEnabled Boolean @default(false)

  // 对于number类型功能，使用limit字段
  limit     Int?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  level   Level   @relation(fields: [levelKey], references: [key])
  feature Feature @relation(fields: [featureKey], references: [key])

  @@unique([levelKey, featureKey])
}

// 价格表
model Price {
  id           String @id @default(cuid())
  productKey   String
  tier         String         // 与levelKey对应
  billingCycle String         // monthly, yearly
  region       String @default("CA")  // CA, US, EU, GB, AU
  currency     String @default("CAD") // CAD, USD, EUR, GBP, AUD
  amount       Int            // 以最小货币单位计价（如分）
  stripePriceId String?       // Stripe价格ID
  isActive     Boolean @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  product      Product @relation(fields: [productKey], references: [key])

  @@unique([productKey, tier, billingCycle, region])
}

// 订阅表
model Subscription {
  id                   String   @id @default(cuid())
  organizationId       String
  productKey           String   // ploml, mopai
  status               SubscriptionStatus // TRIALING|ACTIVE|PAST_DUE|CANCELED|EXPIRED
  tier                 String?  // trial, basic, standard等
  billingCycle         String?  // monthly|yearly
  currentPeriodStart   DateTime?
  currentPeriodEnd     DateTime?
  gracePeriodEnd       DateTime? // 宽限期结束时间
  trialEnd             DateTime?
  stripeSubscriptionId String?  @unique
  stripePriceId        String?
  cancelAtPeriodEnd    Boolean  @default(false)
  version              Int      @default(1)  // 乐观锁
  lastWebhookEventId   String?
  lastSyncedAt         DateTime?
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
  deletedAt            DateTime?

  organization Organization @relation(fields: [organizationId], references: [id])
  product      Product      @relation(fields: [productKey], references: [key])

  @@unique([organizationId, productKey])
}

// Intent表（防竞态条件）
model SubscriptionIntent {
  id                String   @id @default(cuid())
  organizationId    String
  productKey        String
  action            String   // checkout|upgrade|cancel|reactivate|start_trial
  status            String   @default("pending") // pending|completed|failed|expired
  stripePriceId     String?
  stripeCheckoutId  String?
  stripeSubscriptionId String?
  metadata          Json?
  version           Int      @default(1)  // 乐观锁版本控制
  expiresAt         DateTime
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}

// Stripe事件处理表（幂等性）
model StripeEventProcessed {
  id           String   @id  // Stripe event id
  eventType    String
  processed    Boolean  @default(false)
  attempts     Int      @default(0)
  lastError    String?
  processedAt  DateTime?
  createdAt    DateTime @default(now())
}


// 审计日志表
model AuditLog {
  id         String   @id @default(cuid())
  entityType String   // SUBSCRIPTION|ORGANIZATION|TRIAL|INTENT
  entityId   String?
  action     String   // CREATE|UPDATE|DELETE|CANCEL|REACTIVATE
  actorType  String   // USER|ADMIN|WEBHOOK|SYSTEM
  actorId    String?
  changes    Json?
  metadata   Json?
  timestamp  DateTime @default(now())
}
```

## 📖 API文档

### 🎯 前端用户API（需要JWT认证）

基础路径：`/api/frontend`

所有前端API需要JWT Bearer Token认证：
```bash
Authorization: Bearer {jwt_token}
```

#### 用户组织管理

##### 获取用户所有组织概览
```bash
GET /api/frontend/user/organizations-overview
```

**功能**：获取当前用户拥有的所有组织及其订阅状态概览

**成功响应 (200)**：
```json
{
  "success": true,
  "data": {
    "organizations": [
      {
        "id": "org-123",
        "name": "我的店铺",
        "subscriptions": [
          {
            "productKey": "ploml",
            "status": "ACTIVE",
            "tier": "basic",
            "features": ["基础功能1", "基础功能2"],
            "isActive": true
          }
        ]
      }
    ]
  }
}
```

**错误响应 (401)**：
```json
{
  "error": "unauthorized",
  "message": "Invalid or missing JWT token"
}
```

##### 创建新组织
```bash
POST /api/frontend/user/organizations
Content-Type: application/json
```

**请求体**：
```json
{
  "name": "新店铺名称",
  "email": "shop@example.com"
}
```

**成功响应 (201)**：
```json
{
  "success": true,
  "data": {
    "id": "org-456",
    "name": "新店铺名称",
    "stripeCustomerId": "cus_stripe123",
    "hasUsedTrial": false
  }
}
```

#### 产品信息查询

##### 获取产品定价
```bash
GET /api/frontend/products/{productKey}/pricing
```

**路径参数**：
- `productKey`: `ploml` | `mopai`

**成功响应 (200)**：
```json
{
  "success": true,
  "data": {
    "productKey": "ploml",
    "tiers": {
      "trial": {
        "name": "试用版",
        "monthlyPrice": 0,
        "yearlyPrice": 0,
        "features": ["试用功能1", "试用功能2"]
      },
      "basic": {
        "name": "基础版",
        "monthlyPrice": 29,
        "yearlyPrice": 290,
        "features": ["基础功能1", "基础功能2"]
      }
    },
    "currency": "CAD",
    "trialPeriodDays": 30
  }
}
```

##### 获取产品功能列表
```bash
GET /api/frontend/products/{productKey}/features
```

**成功响应 (200)**：
```json
{
  "success": true,
  "data": {
    "productKey": "ploml",
    "features": {
      "trial": ["试用功能1", "试用功能2"],
      "basic": ["基础功能1", "基础功能2", "基础功能3"],
      "standard": ["基础功能1", "基础功能2", "标准功能1"]
    }
  }
}
```

#### 组织订阅管理

需要组织访问权限验证。

##### 获取组织订阅状态
```bash
GET /api/frontend/organizations/{organizationId}/subscription-status
```

**成功响应 (200)**：
```json
{
  "success": true,
  "data": {
    "subscriptions": [
      {
        "productKey": "ploml",
        "status": "ACTIVE",
        "tier": "basic",
        "currentPeriodEnd": "2024-12-25T00:00:00Z",
        "features": ["基础功能1", "基础功能2"],
        "isActive": true
      }
    ]
  }
}
```

##### 检查功能权限
```bash
GET /api/frontend/organizations/{organizationId}/products/{productKey}/features/{featureKey}/access
```

**成功响应 (200)**：
```json
{
  "success": true,
  "data": {
    "hasAccess": true,
    "tier": "basic",
    "reason": "granted"
  }
}
```

**无权限响应 (200)**：
```json
{
  "success": true,
  "data": {
    "hasAccess": false,
    "tier": "basic",
    "reason": "tier_restriction",
    "message": "Current plan does not support this feature"
  }
}
```

#### 订阅操作

##### 开始试用
```bash
POST /api/frontend/organizations/{organizationId}/subscriptions/start-trial
Content-Type: application/json
```

**请求体**：
```json
{
  "productKey": "ploml"
}
```

**成功响应 (201)**：
```json
{
  "success": true,
  "data": {
    "subscription": {
      "id": "sub-123",
      "productKey": "ploml",
      "status": "TRIALING",
      "tier": "trial",
      "trialEnd": "2024-10-25T00:00:00Z"
    },
    "trialPeriodDays": 30,
    "features": ["试用功能1", "试用功能2"]
  }
}
```

**错误响应 (409)**：
```json
{
  "error": "conflict",
  "message": "已经使用过试用期"
}
```

##### 创建支付会话
```bash
POST /api/frontend/organizations/{organizationId}/subscriptions/checkout
Content-Type: application/json
```

**请求体**：
```json
{
  "productKey": "ploml",
  "tier": "basic",
  "billingCycle": "monthly",
  "successUrl": "https://app.com/success",
  "cancelUrl": "https://app.com/cancel"
}
```

**成功响应 (200)**：
```json
{
  "success": true,
  "data": {
    "checkoutUrl": "https://checkout.stripe.com/pay/cs_test_123"
  }
}
```

##### 升级订阅
```bash
POST /api/frontend/organizations/{organizationId}/subscriptions/upgrade
Content-Type: application/json
```

**请求体**：
```json
{
  "subscriptionId": "sub-123",
  "newTier": "standard",
  "billingCycle": "monthly"
}
```

**成功响应 (200)**：
```json
{
  "success": true,
  "data": {
    "subscription": {
      "id": "sub-123",
      "tier": "standard",
      "status": "ACTIVE"
    },
    "features": ["基础功能1", "基础功能2", "标准功能1"]
  }
}
```

##### 取消订阅
```bash
POST /api/frontend/organizations/{organizationId}/subscriptions/cancel
Content-Type: application/json
```

**请求体**：
```json
{
  "subscriptionId": "sub-123",
  "cancelAtPeriodEnd": true
}
```

**成功响应 (200)**：
```json
{
  "success": true,
  "data": {
    "subscription": {
      "id": "sub-123",
      "status": "ACTIVE",
      "cancelAtPeriodEnd": true
    }
  },
  "message": "Subscription will be canceled at the end of current billing period"
}
```

---

### 🔧 内部订阅API（需要内部API Key）

基础路径：`/api/subscriptions`

所有内部API需要内部API密钥：
```bash
X-Internal-API-Key: {internal_api_key}
```

#### 试用订阅管理

##### 创建试用订阅
```bash
POST /api/subscriptions/trial
Content-Type: application/json
```

**请求体**：
```json
{
  "organizationId": "org-123",
  "productKey": "ploml",
  "userId": "user-456"
}
```

**成功响应 (201)**：
```json
{
  "success": true,
  "data": {
    "subscription": {
      "id": "sub-123",
      "organizationId": "org-123",
      "productKey": "ploml",
      "status": "TRIALING",
      "tier": "trial",
      "trialEnd": "2024-10-25T00:00:00Z"
    },
    "trialPeriodDays": 30,
    "features": ["试用功能1", "试用功能2"]
  }
}
```

#### 付费订阅管理

##### 创建付费订阅
```bash
POST /api/subscriptions/paid
Content-Type: application/json
```

**请求体**：
```json
{
  "organizationId": "org-123",
  "productKey": "ploml",
  "tier": "basic",
  "billingCycle": "monthly",
  "successUrl": "https://app.com/success",
  "cancelUrl": "https://app.com/cancel"
}
```

**成功响应 (200)**：
```json
{
  "success": true,
  "data": {
    "checkoutUrl": "https://checkout.stripe.com/pay/cs_test_123"
  }
}
```

##### 升级订阅
```bash
PATCH /api/subscriptions/{subscriptionId}/upgrade
Content-Type: application/json
```

**请求体**：
```json
{
  "newTier": "standard",
  "billingCycle": "yearly"
}
```

##### 取消订阅
```bash
PATCH /api/subscriptions/{subscriptionId}/cancel
Content-Type: application/json
```

**请求体**：
```json
{
  "cancelAtPeriodEnd": true
}
```

#### 订阅查询

##### 获取订阅详情
```bash
GET /api/subscriptions/{subscriptionId}
```

##### 获取组织特定产品订阅
```bash
GET /api/subscriptions/organization/{organizationId}/product/{productKey}
```

##### 获取组织所有订阅
```bash
GET /api/subscriptions/organization/{organizationId}
```

**成功响应 (200)**：
```json
{
  "success": true,
  "data": {
    "subscriptions": [
      {
        "id": "sub-123",
        "productKey": "ploml",
        "status": "ACTIVE",
        "tier": "basic"
      }
    ],
    "summary": {
      "activeCount": 1,
      "trialingCount": 0,
      "totalValue": 29
    },
    "availableProducts": ["ploml", "mopai"],
    "tiers": {
      "basic": { "name": "基础版", "monthlyPrice": 29 }
    }
  }
}
```

##### 检查功能权限
```bash
GET /api/subscriptions/organization/{organizationId}/product/{productKey}/feature/{featureKey}
```

##### 获取产品定价
```bash
GET /api/subscriptions/pricing/{productKey}
```

---

### 🔍 微服务权限API（需要JWT认证）

基础路径：`/api/microservices`

#### 权限检查

##### 检查微服务权限
```bash
POST /api/microservices/check-permission
Content-Type: application/json
Authorization: Bearer {jwt_token}
```

**请求体**：
```json
{
  "organizationId": "org-123",
  "serviceKey": "auth-service"
}
```

**成功响应 (200)**：
```json
{
  "success": true,
  "data": {
    "allowed": true,
    "reason": "granted",
    "currentUsage": 150,
    "limit": 1000,
    "resetTime": "2024-10-01T00:00:00Z",
    "tier": "basic"
  }
}
```

**权限不足响应 (403)**：
```json
{
  "error": "no_active_subscription",
  "message": "This organization does not have a valid subscription"
}
```

#### 微服务访问管理

##### 获取可访问的微服务列表
```bash
GET /api/microservices/accessible/{organizationId}
Authorization: Bearer {jwt_token}
```

**成功响应 (200)**：
```json
{
  "success": true,
  "data": {
    "tier": "basic",
    "services": [
      {
        "serviceKey": "auth-service",
        "limits": {
          "enabled": true,
          "hourlyRequests": 1000,
          "dailyRequests": 10000,
          "concurrentRequests": 10
        }
      }
    ]
  }
}
```

##### 获取微服务使用统计
```bash
GET /api/microservices/stats/{organizationId}?serviceKey=auth-service&periodType=daily
Authorization: Bearer {jwt_token}
```

**成功响应 (200)**：
```json
{
  "success": true,
  "data": {
    "organizationId": "org-123",
    "tier": "basic",
    "usage": [
      {
        "serviceKey": "auth-service",
        "usagePeriod": "2024-09-25",
        "requestCount": 150
      }
    ],
    "concurrent": [],
    "timestamp": "2024-09-25T10:30:00Z"
  }
}
```

##### 获取微服务使用情况
```bash
GET /api/microservices/usage/{organizationId}
Authorization: Bearer {jwt_token}
```

##### 清理过期并发请求记录
```bash
POST /api/microservices/cleanup-expired
```

**成功响应 (200)**：
```json
{
  "success": true,
  "message": "Cleanup completed"
}
```

---

### 🔗 Webhook API

#### Stripe Webhook
```bash
POST /api/webhooks/stripe
Content-Type: application/json
Stripe-Signature: {stripe_signature}
```

**功能**：处理Stripe webhook事件，更新本地订阅状态

**处理的事件类型**：
- `checkout.session.completed` - 支付会话完成
- `customer.subscription.created` - 订阅创建
- `customer.subscription.updated` - 订阅更新
- `customer.subscription.deleted` - 订阅删除
- `invoice.payment_succeeded` - 支付成功
- `invoice.payment_failed` - 支付失败

**成功响应 (200)**：
```json
{
  "received": true
}
```

**错误响应 (400)**：
```json
{
  "error": "Invalid signature"
}
```

---

### 🛡️ Admin API（需要API Key + 维护模式）

基础路径：`/api/admin`

⚠️ **重要警告**：Admin API仅限维护/修复用途，生产环境需要维护模式和API密钥。

**认证要求**：
```bash
X-API-Key: {internal_api_key}
# 环境变量: ADMIN_MAINTENANCE_MODE=true
```

#### 组织管理

##### 创建组织
```bash
POST /api/admin/organizations
X-API-Key: {api_key}
Content-Type: application/json
```

##### 获取组织
```bash
GET /api/admin/organizations/{organizationId}
X-API-Key: {api_key}
```

##### 更新组织
```bash
PATCH /api/admin/organizations/{organizationId}
X-API-Key: {api_key}
Content-Type: application/json
```

#### 订阅管理

##### 创建订阅（仅维护模式）
```bash
POST /api/admin/subscriptions
X-API-Key: {api_key}
Content-Type: application/json
```

⚠️ **注意**：此接口仅用于运维修复，所有调用会写入审计日志。

##### 更新订阅状态
```bash
PATCH /api/admin/subscriptions/{subscriptionId}/status
X-API-Key: {api_key}
Content-Type: application/json
```

---

### 📊 通用错误响应格式

所有API遵循统一的错误响应格式：

#### 400 Bad Request
```json
{
  "error": "bad_request",
  "message": "Missing required parameters: organizationId, productKey"
}
```

#### 401 Unauthorized
```json
{
  "error": "unauthorized",
  "message": "Invalid or missing JWT token"
}
```

#### 403 Forbidden
```json
{
  "error": "organization_access_denied",
  "message": "No permission to access this organization"
}
```

#### 404 Not Found
```json
{
  "error": "not_found",
  "message": "Subscription not found"
}
```

#### 409 Conflict
```json
{
  "error": "conflict",
  "message": "Organization already has ploml product subscription"
}
```

#### 500 Internal Server Error
```json
{
  "error": "server_error",
  "message": "Failed to create subscription"
}
```

## 🔒 认证与安全

### JWT认证机制

1. **JWT验证流程**:
   - 提取Bearer token
   - 使用JWKS获取公钥（缓存1小时）
   - 验证token签名和声明
   - 注入用户上下文到req.ctx

2. **JWT Claims验证**:
   ```javascript
   {
     "iss": "http://tymoe.com:8080",  // 必须匹配
     "aud": "tymoe-service",          // 必须匹配
     "sub": "user-id",
     "organizations": [...],          // 用户拥有的组织
     "exp": timestamp
   }
   ```

### API Key认证

Admin API使用内部API密钥：
- 检查`X-API-Key`头部
- 与`INTERNAL_API_KEY`环境变量精确匹配
- 需要`ADMIN_MAINTENANCE_MODE=true`

### 审计日志

所有Admin操作和重要业务操作都记录审计日志：

#### AuditLog 数据模型
```prisma
model AuditLog {
  id         String   @id @default(cuid())
  entityType String   // SUBSCRIPTION|ORGANIZATION|TRIAL|INTENT
  entityId   String?  // 相关实体ID
  action     String   // CREATE|UPDATE|DELETE|CANCEL|REACTIVATE
  actorType  String   // USER|ADMIN|WEBHOOK|SYSTEM
  actorId    String?  // 操作者ID (用户ID或admin标识)
  changes    Json?    // 具体变更内容
  metadata   Json?    // 附加元数据 (如ticketId, reason等)
  timestamp  DateTime @default(now())
}
```

#### 审计日志示例
```javascript
{
  entityType: "SUBSCRIPTION",
  entityId: "sub-123",
  action: "UPDATE",
  actorType: "ADMIN",
  actorId: "admin-user-id",
  changes: { status: "ACTIVE" },
  metadata: {
    ticketId: "TICKET-123",
    reason: "Customer support manual reactivation",
    originalStatus: "CANCELED"
  }
}
```

#### Admin API 审计日志记录
Admin API的所有操作都会自动记录审计日志：

- **POST /admin/subscriptions**: 记录手动创建订阅的操作，包含`reason`和`ticketId`
- **PATCH /admin/subscriptions/{id}/status**: 记录状态变更操作
- **GET /admin/audit-logs**: 查询审计日志，支持按实体类型、操作者等条件过滤

通过审计日志可以：
1. 追踪所有敏感操作的完整历史
2. 区分用户操作、管理员操作、Webhook操作和系统操作
3. 记录操作的具体原因和上下文信息
4. 支持合规性审计和问题排查

## 🎯 业务逻辑详解

### 权限系统（Entitlement-based）

1. **级别管理**: 通过Level表定义5个级别（trial, basic, standard, advanced, pro）
2. **功能配置**: 通过Feature表定义所有可用功能（API请求、存储、团队成员等）
3. **权限矩阵**: 通过Entitlement表配置每个级别对应的功能权限和限制
4. **权限检查**: `getOrganizationFeatures`方法基于用户订阅级别返回具体权限
5. **动态配置**: 权限配置完全数据驱动，无需修改代码即可调整

### 多地区支持

1. **默认地区**: 服务默认使用CA（加拿大）地区和CAD货币
2. **地区检测**: 支持通过API参数传递region，自动映射对应货币
3. **价格管理**: Price表支持多地区定价，每个地区可有不同价格
4. **Stripe集成**: 支持多地区Stripe账户配置（可选）

### 订阅过期逻辑

1. **正常过期**: 基于`currentPeriodEnd`字段判断订阅是否过期
2. **宽限期**: 支持`gracePeriodEnd`字段，过期后给予额外宽限期
3. **状态管理**: 过期后自动将订阅状态更新为`expired`
4. **功能限制**: 过期订阅无法使用付费功能，但可保留基本访问

### Trial管理逻辑

1. **Trial限制**: 每个组织只能使用一次trial，通过`hasUsedTrial`字段控制
2. **Trial创建**: 创建trial订阅时，同时标记`organization.hasUsedTrial=true`
3. **Trial转换**: Webhook接收到付费后，自动将trial转为付费订阅

### Intent防竞态机制

1. **Intent创建**: 所有付费操作先创建pending intent，包含地区和货币信息
2. **Stripe集成**: 创建Checkout Session，metadata包含intentId和地区信息
3. **Webhook处理**: 接收Stripe事件后，更新intent为completed
4. **订阅更新**: 基于intent信息更新本地订阅状态

### 乐观锁机制

订阅更新使用version字段实现乐观锁：
```javascript
// 更新订阅时检查版本
const updated = await prisma.subscription.update({
  where: {
    id: subscriptionId,
    version: currentVersion
  },
  data: {
    status: 'active',
    version: currentVersion + 1
  }
});

if (!updated) {
  // 版本冲突，重试逻辑
}
```

### 审计日志系统

1. **全面记录**: 记录所有敏感操作（订阅创建、更新、取消等）
2. **操作者追踪**: 区分用户操作、管理员操作、Webhook操作和系统操作
3. **变更详情**: 记录具体的字段变更内容，支持合规审计
4. **元数据支持**: 支持附加元数据，如工单号、原因等

## 🧪 测试

### 运行测试
```bash
# 单元测试
npm test

# 集成测试
npm run test:integration

# 测试覆盖率
npm run test:coverage
```

### 测试用例要求

必须包含以下测试用例：

1. **JWT验证**:
   - 有效token验证
   - 无效token拒绝
   - 过期token处理

2. **组织同步**:
   - 新组织创建
   - 现有组织更新
   - 用户ID冲突处理

3. **Trial管理**:
   - 首次trial创建
   - 重复trial拒绝
   - Trial过期处理

4. **Intent流程**:
   - Intent创建和过期
   - Webhook更新Intent
   - 竞态条件处理

5. **Webhook处理**:
   - 事件幂等性 (必须包含重复事件处理测试)
   - 订阅状态同步
   - 错误处理和重试
   - 并发事件处理 (同时收到相同事件)
   - 事件顺序错乱处理

**Webhook 幂等性测试示例**

```typescript
describe('Webhook幂等性', () => {
  const testEvent = {
    id: 'evt_test_123',
    type: 'invoice.payment_succeeded',
    data: { object: { subscription: 'sub_test_123' } }
  };

  it('should process the same event only once', async () => {
    // 第一次请求成功处理
    const res1 = await request(app)
      .post('/webhooks/stripe')
      .set('Stripe-Signature', 'valid_signature')
      .send(testEvent);
    expect(res1.status).toBe(200);

    // 第二次请求应跳过，返回"Event already processed"
    const res2 = await request(app)
      .post('/webhooks/stripe')
      .set('Stripe-Signature', 'valid_signature')
      .send(testEvent);
    expect(res2.status).toBe(200);

    // 数据库中该事件只记录一条处理结果
    const record = await prisma.stripeEventProcessed.findUnique({
      where: { eventId: 'evt_test_123' }
    });
    expect(record?.processed).toBe(true);
    expect(record?.attempts).toBeGreaterThanOrEqual(2); // 被尝试处理2次
  });
})
```

> 注：`attempts` 字段记录了事件尝试处理的次数，即使事件只被真正处理一次，也会递增，用于排查重试/并发情况。

  it('should handle concurrent duplicate requests', async () => {
    // 并发发送相同事件
    const promises = Array(3).fill(null).map(() =>
      request(app)
        .post('/webhooks/stripe')
        .set('Stripe-Signature', 'valid_signature')
        .send(testEvent)
    );

    const results = await Promise.all(promises);

    // 所有请求返回成功，但只处理一次
    results.forEach(r => expect(r.status).toBe(200));

    // 验证数据库中只有一条记录
    const records = await prisma.stripeEventProcessed.findMany({
      where: { eventId: 'evt_test_123' }
    });
    expect(records).toHaveLength(1);
  });
});
```

## 📊 监控与日志

### 结构化日志

使用Winston进行结构化日志记录：

```javascript
logger.info('Subscription intent created', {
  intentId: intent.id,
  organizationId,
  productId,
  actionType
});

logger.error('Failed to process webhook', {
  error: error.message,
  eventId: event.id,
  eventType: event.type
});
```

### 关键指标监控

- Intent创建数量和成功率
- Webhook处理延迟和成功率
- Trial转换率
- 订阅状态分布
- API响应时间和错误率

## 🚀 部署

### Docker部署

```bash
# 构建镜像
docker build -t subscription-service .

# 运行服务
docker run -d \
  --name subscription-service \
  -p 8088:8088 \
  --env-file .env \
  subscription-service
```

### 环境检查清单

部署前确认：
- [ ] 所有必需环境变量已设置
- [ ] 数据库迁移已执行
- [ ] Stripe Webhook已配置
- [ ] JWKS URL可访问
- [ ] 日志级别适合环境
- [ ] 监控和告警已设置

## 🔧 故障排除

### 常见问题

1. **JWT验证失败**:
   - 检查JWKS_URL是否可访问
   - 验证token的iss和aud声明
   - 确认公钥缓存是否正常

2. **Webhook处理失败**:
   - 验证STRIPE_WEBHOOK_SECRET
   - 检查事件签名验证
   - 查看重试和错误日志

3. **Intent超时**:
   - 调整INTENT_TTL_MINUTES
   - 检查清理任务运行
   - 监控Intent处理延迟

4. **数据库版本冲突**:
   - 检查乐观锁实现
   - 监控并发更新操作
   - 调整重试机制

### 日志查看

```bash
# 查看服务日志
docker logs -f subscription-service

# 过滤特定类型日志
docker logs subscription-service | grep "ERROR"

# 查看审计日志
docker logs subscription-service | grep "audit"
```

## 📋 变更日志

### v2024.12.1 - TypeScript严格检查修复 & 类型安全增强

#### 🔧 重大修改

**TypeScript严格检查修复**
- 🛡️ 修复所有TypeScript编译错误，确保严格模式通过
- ⚡ 完善null安全处理，添加默认值和类型守护
- 🔧 修复Prisma查询语法错误（unique约束名称）
- 📦 修正ES模块导入路径（添加.js扩展名）

**核心服务优化**
- 🔄 修复subscription服务中的Promise处理和async/await问题
- 🛠️ 更新microservicePermissionService，移除不存在的模型引用
- ⚙️ 优化subscriptionIntent服务的类型定义和null处理
- 🔧 修复organizationService中的接口类型匹配

**数据访问层改进**
- 📊 更新Prisma查询，使用findFirst替代错误的findUnique调用
- 🔄 修复Price模型查询中的复合unique约束问题
- 🛡️ 增强subscription.tier字段的null安全处理

#### 🗂️ 修复的文件

```bash
# Controllers - 11处修复
src/controllers/frontend.ts                # 3处null安全问题
src/controllers/subscription.ts            # 5处null安全问题
src/controllers/organization.ts            # 2处null安全问题

# Routes - 3处修复
src/routes/microservice.ts                 # 3处null安全问题

# Services - 22+处修复
src/services/subscription.ts               # 9+处复杂类型错误
src/services/microservicePermissionService.ts # 8处模型/约束错误
src/services/organization.ts               # 1处类型定义错误
src/services/subscriptionIntent.service.ts # 4处导入/类型错误

# Scripts - 1处修复
src/scripts/seed-data.ts                   # 1处Prisma约束错误

# Middleware - 1处修复
src/middleware/microservicePermission.ts   # 1处参数匹配错误

# Configuration - 已在v2024.12中修复
src/config/defaults.ts                     # Currency类型修复
```

#### ⚠️ 主要修复类型

1. **Null安全处理**: 在所有可能为null的字段添加 `|| 'basic'` 等默认值
2. **Prisma查询修复**:
   - `findUnique` → `findFirst` (当unique约束不存在时)
   - 移除不存在的复合约束如 `productKey_tier_billingCycle`
   - 修复seed脚本中的错误约束使用
3. **Promise/Async修复**: 修复subscription服务中未正确await的Promise调用
4. **ES模块导入**: 添加缺失的.js扩展名到import语句
5. **类型断言优化**: 使用适当的类型守护和null检查替代危险的类型断言

#### ✅ 验证结果

- ✅ `npm run typecheck` 通过，无TypeScript错误
- ✅ 所有null访问都有适当的默认值处理
- ✅ Prisma查询语法正确，匹配实际schema定义
- ✅ ES模块导入路径完整且正确

#### 🔗 技术影响

- **代码安全性**: 消除了潜在的运行时null错误
- **类型安全**: 确保严格TypeScript检查通过
- **开发体验**: IDE现在可以提供准确的类型提示
- **构建稳定性**: CI/CD流程中的TypeScript检查将保持通过

---

### v2024.12 - TypeScript类型安全 & 软删除支持

#### 🔧 重大修改

**数据库Schema更新**
- 📊 添加 `deletedAt` 字段到 `Organization` 和 `Subscription` 模型，支持软删除
- 🔄 增强 `StripeEventProcessed` 模型的 `attempts` 字段支持，用于webhook重试追踪

**TypeScript类型优化**
- 🛡️ 修复货币/地区类型不匹配问题（`Currency` 类型定义）
- ⚡ 更新Prisma客户端类型，确保类型安全
- 🔧 修复webhook服务中Stripe状态映射错误

**Webhook幂等性增强**
- 📈 完善attempts字段追踪，支持并发和重试场景监控
- 🧪 更新所有webhook相关测试，包含attempts断言验证
- 📖 更新README中的测试示例和说明文档

#### 🗂️ 影响的文件

```bash
# Schema & Database
prisma/schema.prisma                    # 添加deletedAt软删除字段

# Core Services
src/services/webhook.service.ts         # 修复状态映射错误
src/config/defaults.ts                  # 修复Currency类型定义

# Tests (增加attempts验证)
tests/unit/webhook-idempotency.test.ts  # webhook幂等性单元测试
tests/integration/webhook.test.ts       # webhook集成测试
tests/unit/services/webhook.service.test.ts # webhook服务测试

# Documentation
README.md                               # 更新测试示例和attempts说明
```

#### ⚠️ 迁移注意事项

1. **数据库迁移**: 新增的 `deletedAt` 字段需要数据库迁移
2. **测试更新**: 所有webhook测试现在验证 `attempts` 字段行为
3. **类型检查**: 运行 `npm run typecheck` 确保类型安全

#### 🔗 相关PR/Issue
- Webhook幂等性增强和TypeScript类型修复
- 软删除支持和数据完整性改进

---

## 📚 相关文档

- [Stripe API文档](https://stripe.com/docs/api)
- [Prisma文档](https://www.prisma.io/docs/)
- [JWT最佳实践](https://tools.ietf.org/html/rfc7519)
- [企业级Node.js架构](https://nodejs.org/en/docs/guides/nodejs-enterprise-best-practices/)

---

**技术栈**: Node.js 20+ • TypeScript • Express • Prisma • PostgreSQL • Stripe SDK • JWT

**联系方式**: 如需技术支持，请查看日志或联系开发团队