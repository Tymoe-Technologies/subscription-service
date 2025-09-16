# Tymoe Subscription Service v0.2.1

> **订阅管理与计费中心** - 基于Stripe的企业级订阅管理服务

## 🌐 服务概述

**服务职责**: Subscription Service 负责管理 Tymoe SaaS 平台的订阅计费、功能权限控制和客户管理  
**技术栈**: Node.js + TypeScript + Express + Prisma + Stripe API  
**服务端口**: 8088  

⚠️ **重要提醒**: 请勿直接修改数据库内容！所有数据操作必须通过API接口进行！

## 📖 目录

- [服务概述](#服务概述)
- [最新更新](#最新更新)
- [快速开始-API调用](#快速开始-api调用)
- [API接口详解](#api接口详解)
- [数据库架构](#数据库架构)
- [核心功能模块详解](#核心功能模块详解)
- [配置参数详解](#配置参数详解)
- [与其他服务集成](#与其他服务集成)
- [部署运维](#部署运维)
- [开发指南](#开发指南)
- [故障排除](#故障排除)

## 最新更新 ✨

### v0.2.1 类型安全和稳定性提升

1. **TypeScript类型安全增强**
   - 修复所有控制器函数的返回类型注解 (Promise<void>)
   - 解决Redis配置类型兼容性问题
   - 优化Stripe API版本兼容性 (2023-10-16)
   - 改进服务层类型安全性

2. **代码质量提升**
   - 统一错误处理模式（避免return语句）
   - 增强参数验证和空值检查
   - 优化可选属性处理
   - 符合VSCode IDE标准的代码风格

3. **架构稳定性改进**
   - 修复Prisma数据模型类型匹配
   - 改进Redis连接配置
   - 优化Stripe元数据处理
   - 增强错误边界处理

### v0.2.0 重大功能更新

1. **新增前端缓存优化API**
   - 添加 `GET /api/organizations/{organizationId}/cache-info` 端点
   - 提供优化的缓存数据格式，减少90%的API调用
   - 支持自动缓存过期机制（10分钟）

2. **增强的组织订阅管理**
   - 优化 `getOrganizationWithSubscriptions` 返回格式
   - 自动添加功能列表到订阅信息
   - 改进的活跃状态判断逻辑

## 🚀 快速开始-API调用

### 基础信息
- **服务端口**: `8088`
- **API前缀**: `/api`
- **认证方式**: X-API-Key Header

### 常用端点示例

```bash
# 创建组织
curl -X POST http://localhost:8088/api/organizations \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"id":"org-123","name":"测试公司","email":"admin@company.com"}'

# 获取组织订阅信息
curl http://localhost:8088/api/organizations/org-123/subscriptions \
  -H "X-API-Key: your-api-key"

# 获取前端缓存信息
curl http://localhost:8088/api/organizations/org-123/cache-info \
  -H "X-API-Key: your-api-key"

# 创建试用订阅
curl -X POST http://localhost:8088/api/subscriptions/trial \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"organizationId":"org-123","productKey":"ploml"}'

# 健康检查
curl http://localhost:8088/healthz
```

### 核心功能

- **多产品订阅管理**: 支持 ploml（美业）和 mopai（餐饮）两个产品线
- **分级订阅套餐**: Trial → Basic → Standard → Advanced → Pro 五个等级
- **功能权限控制**: 细粒度的功能级别权限管理
- **Stripe 集成**: 完整的支付和计费管理
- **前端缓存优化**: 专为前端性能优化的缓存API
- **企业级安全**: 内部API密钥验证，审计日志

### 技术栈
- **后端**: Node.js + TypeScript + Express
- **数据库**: PostgreSQL + Prisma ORM
- **缓存**: Redis (速率限制、缓存管理)
- **支付**: Stripe API
- **安全**: API Key验证, CORS, Rate Limiting

## 数据库架构

### 组织订阅模型

```sql
-- 组织表：简化的组织订阅模型
Organization {
  id                String   @id @default(cuid())
  name              String
  stripeCustomerId  String?  @unique @map("stripe_customer_id")
  hasUsedTrial      Boolean  @default(false) @map("has_used_trial")
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  subscriptions     Subscription[]
  @@map("organizations")
}

-- 产品表：ploml（美业）、mopai（餐饮）
Product {
  key       String   @id // "ploml" | "mopai"
  name      String   // "Ploml Beauty Management" | "Mopai F&B Management"
  active    Boolean  @default(true)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  subscriptions Subscription[]
  prices        Price[]
  @@map("products")
}

-- 订阅计划
Subscription {
  id                    String    @id @default(cuid())
  organizationId        String    @map("organization_id")
  productKey            String    @map("product_key")
  tier                  String    // "trial" | "basic" | "standard" | "advanced" | "pro"
  status                String    // "trialing" | "active" | "past_due" | "canceled" | "incomplete"
  billingCycle          String?   @map("billing_cycle") // "monthly" | "yearly"
  currentPeriodStart    DateTime? @map("current_period_start")
  currentPeriodEnd      DateTime? @map("current_period_end")
  trialEnd              DateTime? @map("trial_end")
  stripeSubscriptionId  String?   @unique @map("stripe_subscription_id")
  stripePriceId         String?   @map("stripe_price_id")
  cancelAtPeriodEnd     Boolean   @default(false) @map("cancel_at_period_end")
  createdAt             DateTime  @default(now()) @map("created_at")
  updatedAt             DateTime  @updatedAt @map("updated_at")

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  product      Product      @relation(fields: [productKey], references: [key])
  price        Price?       @relation(fields: [stripePriceId], references: [stripePriceId])

  @@unique([organizationId, productKey])
  @@map("subscriptions")
}

-- Stripe价格配置
Price {
  id            String  @id @default(cuid())
  stripePriceId String  @unique @map("stripe_price_id")
  productKey    String  @map("product_key")
  tier          String  // "basic" | "standard" | "advanced" | "pro"
  billingCycle  String  @map("billing_cycle") // "monthly" | "yearly"
  amount        Int     // 价格（分）
  currency      String  @default("usd")
  active        Boolean @default(true)
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  product       Product        @relation(fields: [productKey], references: [key])
  subscriptions Subscription[]

  @@unique([productKey, tier, billingCycle])
  @@map("prices")
}
```

## API接口详解

### 🎯 API端点概览

**基础URL**: `http://localhost:8088`

#### 组织管理端点 (`/api/organizations`)
- **创建组织**: `POST /api/organizations`
- **获取组织信息**: `GET /api/organizations/{organizationId}`
- **获取组织订阅**: `GET /api/organizations/{organizationId}/subscriptions`
- **获取缓存信息**: `GET /api/organizations/{organizationId}/cache-info`
- **更新组织信息**: `PATCH /api/organizations/{organizationId}`
- **删除组织**: `DELETE /api/organizations/{organizationId}`
- **获取试用状态**: `GET /api/organizations/{organizationId}/trial-status`
- **组织列表**: `GET /api/organizations` (管理员)

#### 订阅管理端点 (`/api/subscriptions`)
- **创建试用订阅**: `POST /api/subscriptions/trial`
- **创建付费订阅**: `POST /api/subscriptions/paid`
- **升级订阅**: `PATCH /api/subscriptions/{subscriptionId}/upgrade`
- **取消订阅**: `PATCH /api/subscriptions/{subscriptionId}/cancel`
- **获取订阅详情**: `GET /api/subscriptions/{subscriptionId}`
- **获取特定产品订阅**: `GET /api/subscriptions/organization/{organizationId}/product/{productKey}`
- **获取组织订阅摘要**: `GET /api/subscriptions/organization/{organizationId}/summary`

#### 计费管理端点 (`/api/billing`)
- **创建结账会话**: `POST /api/billing/checkout-session`
- **创建客户门户**: `POST /api/billing/customer-portal`

#### Webhook端点 (`/api/webhooks`)
- **Stripe Webhook**: `POST /api/webhooks/stripe`

#### 系统端点
- **健康检查**: `GET /healthz`

### 1. 组织管理 (`/api/organizations`)

#### 🏢 创建组织
```http
POST /api/organizations
X-API-Key: your-api-key
Content-Type: application/json

{
  "id": "org-123",
  "name": "我的美容院",
  "email": "admin@company.com"
}
```

**响应示例:**
```json
{
  "success": true,
  "data": {
    "organization": {
      "id": "org-123",
      "name": "我的美容院",
      "email": "admin@company.com",
      "hasUsedTrial": false,
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

#### 📋 获取组织订阅信息
```http
GET /api/organizations/org-123/subscriptions
X-API-Key: your-api-key
```

**响应示例:**
```json
{
  "success": true,
  "data": {
    "organization": {
      "id": "org-123",
      "name": "我的美容院",
      "subscriptions": [
        {
          "id": "sub-456",
          "productKey": "ploml",
          "tier": "basic",
          "status": "active",
          "billingCycle": "monthly",
          "currentPeriodEnd": "2024-02-01T00:00:00.000Z",
          "isActive": true,
          "features": [
            "appointment_booking",
            "customer_management",
            "service_catalog"
          ]
        }
      ]
    }
  }
}
```

#### 🚀 获取前端缓存信息 (新功能)
```http
GET /api/organizations/org-123/cache-info
X-API-Key: your-api-key
```

**响应示例:**
```json
{
  "success": true,
  "data": {
    "organizationId": "org-123",
    "subscriptions": {
      "ploml": {
        "tier": "basic",
        "status": "active",
        "expiresAt": "2024-02-01T00:00:00.000Z",
        "isActive": true,
        "billingCycle": "monthly",
        "features": [
          "appointment_booking",
          "customer_management",
          "service_catalog"
        ]
      },
      "mopai": {
        "tier": null,
        "status": "none",
        "expiresAt": null,
        "isActive": false,
        "billingCycle": null,
        "features": []
      }
    },
    "cacheValidUntil": "2024-01-01T00:10:00.000Z",
    "lastUpdated": "2024-01-01T00:00:00.000Z"
  }
}
```

### 2. 订阅管理 (`/api/subscriptions`)

#### 🎫 创建试用订阅
```http
POST /api/subscriptions/trial
X-API-Key: your-api-key
Content-Type: application/json

{
  "organizationId": "org-123",
  "productKey": "ploml"
}
```

**响应示例:**
```json
{
  "success": true,
  "data": {
    "subscription": {
      "id": "sub-456",
      "organizationId": "org-123",
      "productKey": "ploml",
      "tier": "trial",
      "status": "trialing",
      "trialEnd": "2024-01-31T00:00:00.000Z",
      "features": [
        "appointment_booking",
        "customer_management",
        "service_catalog"
      ]
    }
  }
}
```

#### 💳 创建付费订阅
```http
POST /api/subscriptions/paid
X-API-Key: your-api-key
Content-Type: application/json

{
  "organizationId": "org-123",
  "productKey": "ploml",
  "tier": "basic",
  "billingCycle": "monthly",
  "successUrl": "https://app.com/success",
  "cancelUrl": "https://app.com/cancel"
}
```

**响应示例:**
```json
{
  "success": true,
  "data": {
    "checkoutUrl": "https://checkout.stripe.com/c/pay/cs_test_...",
    "sessionId": "cs_test_..."
  }
}
```

#### ⬆️ 升级订阅
```http
PATCH /api/subscriptions/sub-456/upgrade
X-API-Key: your-api-key
Content-Type: application/json

{
  "newTier": "standard",
  "billingCycle": "yearly"
}
```

### 3. 计费管理 (`/api/billing`)

#### 🛒 创建结账会话
```http
POST /api/billing/checkout-session
X-API-Key: your-api-key
Content-Type: application/json

{
  "organizationId": "org-123",
  "productKey": "ploml",
  "tier": "basic",
  "billingCycle": "monthly",
  "successUrl": "https://app.com/success",
  "cancelUrl": "https://app.com/cancel"
}
```

#### 🏠 创建客户门户
```http
POST /api/billing/customer-portal
X-API-Key: your-api-key
Content-Type: application/json

{
  "organizationId": "org-123",
  "returnUrl": "https://app.com/settings"
}
```

**响应示例:**
```json
{
  "success": true,
  "data": {
    "portalUrl": "https://billing.stripe.com/p/session/pss_..."
  }
}
```

### 🎯 HTTP状态码规范

- **200** - 请求成功
- **201** - 资源创建成功
- **400** - 请求参数错误
- **401** - 未认证或API Key无效
- **403** - 已认证但权限不足
- **404** - 资源未找到
- **409** - 资源冲突（如重复创建）
- **429** - 请求频率过高
- **500** - 服务器内部错误

### ❌ 错误响应格式

```json
{
  "error": "bad_request",
  "message": "参数缺失或无效"
}
```

## 核心功能模块详解

### 📁 项目结构

```
src/
├── controllers/          # 控制器层
│   ├── organization.ts   # 组织管理控制器
│   ├── subscription.ts   # 订阅管理控制器
│   ├── billing.ts        # 计费管理控制器
│   └── webhook.ts        # Webhook处理控制器
├── services/            # 业务逻辑层
│   ├── organization.ts  # 组织管理服务
│   ├── subscription.ts  # 订阅管理服务
│   └── billing.ts       # 计费管理服务
├── middleware/          # 中间件层
│   ├── auth.ts         # API密钥验证中间件
│   └── error.ts        # 错误处理中间件
├── infra/              # 基础设施层
│   ├── prisma.ts       # 数据库连接
│   ├── redis.ts        # Redis连接和缓存服务
│   └── stripe.ts       # Stripe客户端和服务
├── config/             # 配置管理
│   ├── config.ts       # 应用配置
│   └── features.ts     # 功能权限配置 (新增)
├── routes/             # 路由定义
└── types/              # TypeScript类型定义
```

### 🎯 新增核心模块详解

#### 1. **功能权限控制系统** (`src/config/features.ts`)

这是subscription-service独有的核心模块，负责管理不同订阅套餐的功能权限：

```typescript
// 功能配置接口
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
  // ... 更多功能配置
};

// 核心功能函数
export function hasFeatureAccess(
  productKey: string,
  tier: string,
  featureKey: string
): boolean;

export function getTierFeatures(productKey: string, tier: string): string[];
```

**用途**: 
- 定义每个产品线（ploml/mopai）的所有功能
- 控制不同订阅等级的功能访问权限
- 为前端提供功能列表用于UI控制

#### 2. **前端缓存优化服务** (`src/controllers/organization.ts`)

```typescript
// 专为前端缓存设计的API端点
export async function getOrganizationCacheInfo(req: Request, res: Response): Promise<void> {
  // 构建前端缓存友好的数据格式
  const subscriptions: Record<string, any> = {};
  
  for (const subscription of organization.subscriptions) {
    subscriptions[subscription.productKey] = {
      tier: subscription.tier,
      status: subscription.status,
      expiresAt: subscription.currentPeriodEnd || subscription.trialEnd,
      isActive: ['active', 'trialing'].includes(subscription.status),
      billingCycle: subscription.billingCycle,
      features: getTierFeatures(subscription.productKey, subscription.tier)
    };
  }

  // 添加未订阅的产品（显示为无订阅状态）
  const allProducts = ['ploml', 'mopai'];
  for (const productKey of allProducts) {
    if (!subscriptions[productKey]) {
      subscriptions[productKey] = {
        tier: null,
        status: 'none',
        expiresAt: null,
        isActive: false,
        billingCycle: null,
        features: []
      };
    }
  }

  const cacheValidUntil = new Date(Date.now() + 10 * 60 * 1000); // 10分钟后过期
}
```

**核心优势**:
- **减少API调用**: 一次请求获取所有订阅状态
- **缓存友好**: 包含缓存过期时间
- **完整数据**: 包含未订阅产品的状态
- **前端优化**: 数据格式专为前端消费设计

#### 3. **Stripe集成服务** (`src/infra/stripe.ts`)

完整的Stripe支付集成，包含：

```typescript
export class StripeService {
  // 客户管理
  async createCustomer(params: CreateCustomerParams): Promise<Stripe.Customer>;
  async getCustomer(customerId: string): Promise<Stripe.Customer | null>;
  
  // 订阅管理
  async createSubscription(params: CreateSubscriptionParams): Promise<Stripe.Subscription>;
  async updateSubscription(subscriptionId: string, params: UpdateParams): Promise<Stripe.Subscription>;
  async cancelSubscription(subscriptionId: string, cancelAtPeriodEnd?: boolean): Promise<Stripe.Subscription>;
  
  // 价格管理
  async createPrice(params: CreatePriceParams): Promise<Stripe.Price>;
  async getPrice(priceId: string): Promise<Stripe.Price | null>;
  
  // 计费门户
  async createCheckoutSession(params: CheckoutParams): Promise<Stripe.Checkout.Session>;
  async createBillingPortalSession(params: PortalParams): Promise<Stripe.BillingPortal.Session>;
  
  // Webhook处理
  verifyWebhookSignature(payload: string, signature: string): Stripe.Event;
}
```

#### 4. **Redis缓存服务** (`src/infra/redis.ts`)

提供分布式缓存和锁功能：

```typescript
export class CacheService {
  async get<T>(key: string): Promise<T | null>;
  async set(key: string, value: any, ttlSeconds?: number): Promise<void>;
  async delete(key: string): Promise<void>;
  async exists(key: string): Promise<boolean>;
  
  // 分布式锁
  async acquireLock(lockKey: string, ttlSeconds: number = 30): Promise<boolean>;
  async releaseLock(lockKey: string): Promise<void>;
}
```

#### 5. **订阅状态管理** (`src/services/subscription.ts`)

复杂的订阅生命周期管理：

```typescript
export class SubscriptionService {
  // 创建不同类型的订阅
  async createTrialSubscription(organizationId: string, productKey: string);
  async createPaidSubscription(params: CreatePaidSubscriptionParams);
  
  // 订阅操作
  async upgradeSubscription(subscriptionId: string, newTier: string, billingCycle?: string);
  async cancelSubscription(subscriptionId: string, cancelAtPeriodEnd?: boolean);
  
  // Stripe Webhook事件处理
  async handleStripeWebhook(event: Stripe.Event);
  
  // 订阅查询和状态管理
  async getSubscriptionSummary(organizationId: string);
  async getOrganizationSubscription(organizationId: string, productKey: string);
}
```

### 🔄 业务流程详解

#### 1. **试用订阅流程**
```mermaid
sequenceDiagram
    participant F as Frontend
    participant S as Subscription Service
    participant DB as Database
    
    F->>S: POST /api/subscriptions/trial
    S->>DB: 检查组织是否已使用试用
    DB-->>S: 返回试用状态
    S->>DB: 创建试用订阅
    S->>S: 设置30天试用期
    S-->>F: 返回订阅信息
```

#### 2. **付费订阅流程**
```mermaid
sequenceDiagram
    participant F as Frontend
    participant S as Subscription Service
    participant Stripe as Stripe API
    participant DB as Database
    
    F->>S: POST /api/subscriptions/paid
    S->>Stripe: 创建Checkout Session
    Stripe-->>S: 返回Session URL
    S-->>F: 返回支付链接
    F->>Stripe: 用户完成支付
    Stripe->>S: Webhook通知
    S->>DB: 更新订阅状态
```

#### 3. **功能权限检查流程**
```mermaid
sequenceDiagram
    participant App as Business App
    participant S as Subscription Service
    participant Cache as Redis Cache
    
    App->>Cache: 检查缓存的权限信息
    alt 缓存命中
        Cache-->>App: 返回权限信息
    else 缓存未命中
        App->>S: GET /api/organizations/{id}/cache-info
        S-->>App: 返回完整权限信息
        App->>Cache: 缓存权限信息(10分钟)
    end
    App->>App: 基于权限控制功能访问
```

## 配置参数详解

### 🔧 环境配置

#### 开发环境 (.env.development)
```bash
# ==================== 基础配置 ====================
NODE_ENV=development
PORT=8088
SERVICE_NAME=subscription-service

# ==================== 数据库配置 ====================
DATABASE_URL=postgresql://username:password@localhost:5432/tymoe_subscription_dev

# ==================== Redis配置 ====================
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=
REDIS_NAMESPACE=subsvc_dev

# ==================== Stripe配置 ====================
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# ==================== 安全配置 ====================
INTERNAL_API_KEY=dev-api-key-please-change-in-production

# ==================== 邮件配置（可选） ====================
SMTP_HOST=smtp.mailtrap.io
SMTP_PORT=587
SMTP_USER=your_mailtrap_user
SMTP_PASS=your_mailtrap_pass
MAIL_FROM=Tymoe Subscription <no-reply@dev.tymoe.com>

# ==================== 前端集成配置 ====================
FRONTEND_BASE_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
```

#### 生产环境 (.env.production)
```bash
# ==================== 基础配置 ====================
NODE_ENV=production
PORT=8088
SERVICE_NAME=subscription-service

# ==================== 数据库配置 ====================
DATABASE_URL=postgresql://subscription_user:SUPER_SECURE_PASSWORD@db-server:5432/tymoe_subscription_prod

# ==================== Redis配置 ====================
REDIS_URL=redis://redis-server:6379
REDIS_PASSWORD=REDIS_SUPER_SECURE_PASSWORD
REDIS_NAMESPACE=subsvc

# ==================== Stripe配置 ====================
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_live_...

# ==================== 安全配置 ====================
INTERNAL_API_KEY=PRODUCTION_API_KEY_SUPER_SECURE

# ==================== 邮件配置 ====================
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USER=postmaster@mg.tymoe.com
SMTP_PASS=MAILGUN_API_KEY
MAIL_FROM=Tymoe <billing@tymoe.com>

# ==================== 前端集成配置 ====================
FRONTEND_BASE_URL=https://app.tymoe.com
CORS_ORIGINS=https://app.tymoe.com,https://ploml.tymoe.com,https://mopai.tymoe.com
```

### ⚙️ 关键配置说明

#### 1. **Stripe配置**
- `STRIPE_SECRET_KEY`: Stripe API密钥，用于创建订阅和处理支付
- `STRIPE_WEBHOOK_SECRET`: Webhook签名验证密钥，确保Webhook请求来自Stripe

#### 2. **API安全配置**
- `INTERNAL_API_KEY`: 内部服务间调用的API密钥
- 生产环境必须使用高强度密钥

#### 3. **数据库配置**
- 支持PostgreSQL连接池配置
- 建议生产环境启用SSL连接
- 配置适当的超时和重试参数

#### 4. **Redis配置**
- 用于缓存订阅信息和分布式锁
- 生产环境必须设置密码
- 使用专用命名空间避免冲突

## 与其他服务集成

### 🏗️ 微服务架构图

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Auth Service  │    │ Business Apps   │
│   (React/Vue)   │    │   (用户认证)     │    │  (ploml/mopai)  │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          │                      │                      │
          └──────────┬───────────┴──────────────────────┘
                     │
    ┌────────────────▼────────────────┐
    │    Subscription Service         │
    │      (订阅管理中心)              │
    │        端口: 8088               │
    └─────────────┬───────────────────┘
                  │
    ┌─────────────▼───────────────────┐
    │         Stripe API              │
    │      (支付处理平台)              │
    └─────────────────────────────────┘
```

### 1. **与Auth Service集成**

Subscription Service通过内部API调用Auth Service获取组织信息：

```typescript
// 验证组织ID的有效性
const validateOrganizationAccess = async (organizationId: string, userToken: string) => {
  const response = await fetch(`${AUTH_SERVICE_URL}/api/organizations/${organizationId}`, {
    headers: {
      'Authorization': `Bearer ${userToken}`,
      'X-Internal-Service': 'subscription-service'
    }
  });
  
  if (!response.ok) {
    throw new Error('Organization access denied');
  }
  
  return response.json();
};
```

### 2. **前端集成指南**

#### React集成示例
```javascript
// subscription.js - 前端订阅管理模块
class SubscriptionService {
  constructor() {
    this.baseURL = process.env.REACT_APP_SUBSCRIPTION_SERVICE_URL;
    this.apiKey = process.env.REACT_APP_SUBSCRIPTION_API_KEY;
  }

  // 获取组织订阅信息（带缓存）
  async getOrganizationSubscriptions(organizationId, useCache = true) {
    const endpoint = useCache ? 'cache-info' : 'subscriptions';
    const response = await fetch(`${this.baseURL}/api/organizations/${organizationId}/${endpoint}`, {
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch subscription info');
    }
    
    const data = await response.json();
    
    if (useCache) {
      // 缓存数据到localStorage，设置过期时间
      const cacheData = {
        data: data.data,
        expiresAt: data.data.cacheValidUntil
      };
      localStorage.setItem(`subscription_cache_${organizationId}`, JSON.stringify(cacheData));
    }
    
    return data.data;
  }

  // 检查功能权限
  hasFeatureAccess(productKey, featureKey, subscriptions) {
    const subscription = subscriptions[productKey];
    return subscription?.features?.includes(featureKey) || false;
  }

  // 创建试用订阅
  async startTrial(organizationId, productKey) {
    const response = await fetch(`${this.baseURL}/api/subscriptions/trial`, {
      method: 'POST',
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ organizationId, productKey })
    });
    
    return response.json();
  }

  // 升级到付费订阅
  async upgradeToPaid(organizationId, productKey, tier, billingCycle) {
    const response = await fetch(`${this.baseURL}/api/subscriptions/paid`, {
      method: 'POST',
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        organizationId,
        productKey,
        tier,
        billingCycle,
        successUrl: `${window.location.origin}/subscription/success`,
        cancelUrl: `${window.location.origin}/subscription/cancel`
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // 跳转到Stripe结账页面
      window.location.href = data.data.checkoutUrl;
    }
    
    return data;
  }
}

// React组件示例
const SubscriptionStatus = ({ organizationId }) => {
  const [subscriptions, setSubscriptions] = useState(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const loadSubscriptions = async () => {
      try {
        const subscriptionService = new SubscriptionService();
        const data = await subscriptionService.getOrganizationSubscriptions(organizationId);
        setSubscriptions(data.subscriptions);
      } catch (error) {
        console.error('Failed to load subscriptions:', error);
      } finally {
        setLoading(false);
      }
    };
    
    loadSubscriptions();
  }, [organizationId]);

  if (loading) return <div>Loading...</div>;

  return (
    <div className="subscription-status">
      {Object.entries(subscriptions).map(([productKey, subscription]) => (
        <div key={productKey} className="product-subscription">
          <h3>{productKey === 'ploml' ? '美业管理' : '餐饮管理'}</h3>
          <div className="status">
            状态: {subscription.isActive ? '已激活' : '未激活'}
          </div>
          {subscription.isActive && (
            <div className="tier">
              套餐: {subscription.tier}
              {subscription.expiresAt && (
                <span> (到期: {new Date(subscription.expiresAt).toLocaleDateString()})</span>
              )}
            </div>
          )}
          <div className="features">
            可用功能: {subscription.features.length} 项
          </div>
        </div>
      ))}
    </div>
  );
};
```

### 3. **业务应用集成**

业务应用（如ploml、mopai）通过中间件验证功能权限：

```typescript
// 功能权限中间件
export const requireFeatureAccess = (featureKey: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { organizationId } = req.params;
    const productKey = process.env.PRODUCT_KEY; // 'ploml' 或 'mopai'
    
    try {
      // 从缓存或API获取订阅信息
      const subscriptions = await getOrganizationSubscriptions(organizationId);
      const subscription = subscriptions[productKey];
      
      if (!subscription?.isActive || !subscription.features.includes(featureKey)) {
        return res.status(403).json({
          error: 'feature_not_available',
          message: `功能 ${featureKey} 在当前订阅套餐中不可用`,
          upgradeUrl: `/subscription/upgrade?feature=${featureKey}`
        });
      }
      
      next();
    } catch (error) {
      return res.status(500).json({
        error: 'subscription_check_failed',
        message: '无法验证订阅状态'
      });
    }
  };
};

// 使用示例
app.get('/api/advanced-reports', 
  requireFeatureAccess('analytics_reports'),
  (req, res) => {
    // 只有高级套餐用户可以访问
    res.json({ reports: getAdvancedReports() });
  }
);
```

## 快速开始

### 📦 初始化步骤

#### 1. **环境准备**
```bash
# 克隆项目
git clone <repository-url>
cd subscription-service

# 安装依赖
npm install

# 复制环境配置
cp .env.example .env
# 编辑 .env 文件，填入正确的配置信息
```

#### 2. **数据库初始化**
```bash
# 生成Prisma客户端
npx prisma generate

# 运行数据库迁移
npx prisma migrate dev --name init

# (可选) 查看数据库
npx prisma studio
```

#### 3. **Stripe配置**
```bash
# 1. 在Stripe Dashboard中创建产品和价格
# 2. 配置Webhook端点：POST /api/webhooks/stripe
# 3. 复制Webhook签名密钥到环境变量
```

#### 4. **启动服务**
```bash
# 开发模式启动
npm run dev

# 生产模式启动
npm run build
npm start
```

### 🔧 必需的手动配置

#### 1. **Stripe产品和价格配置**

在Stripe Dashboard中创建产品和价格：

```bash
# 示例：为ploml创建基础套餐月付价格
stripe prices create \
  --product=prod_ploml_basic \
  --unit-amount=2900 \
  --currency=usd \
  --recurring='{"interval":"month"}' \
  --metadata='{"productKey":"ploml","tier":"basic","billingCycle":"monthly"}'
```

#### 2. **初始数据填充**

```sql
-- 插入产品数据
INSERT INTO "Product" ("key", "name") VALUES 
('ploml', 'Ploml Beauty Management'),
('mopai', 'Mopai F&B Management');

-- 插入价格数据（需要从Stripe获取实际的price_id）
INSERT INTO "Price" ("stripePriceId", "productKey", "tier", "billingCycle", "amount", "currency") VALUES
('price_ploml_basic_monthly', 'ploml', 'basic', 'monthly', 2900, 'usd'),
('price_ploml_basic_yearly', 'ploml', 'basic', 'yearly', 29000, 'usd');
```

#### 3. **Redis数据结构**

服务会自动创建以下Redis键结构：
- `subsvc:org_cache:{organizationId}` - 组织订阅缓存
- `subsvc:feature_cache:{organizationId}:{productKey}` - 功能权限缓存
- `subsvc:billing_lock:{organizationId}` - 计费操作分布式锁

## 部署运维

### 🐳 Docker部署配置

#### Dockerfile
```dockerfile
FROM node:18-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:18-alpine AS runtime

RUN apk add --no-cache dumb-init curl
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma

EXPOSE 8088

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:8088/healthz || exit 1

USER node
CMD ["dumb-init", "node", "dist/index.js"]
```

#### docker-compose.yml
```yaml
version: '3.8'

services:
  subscription-service:
    build: .
    ports:
      - "8088:8088"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=redis://redis:6379
      - STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}
      - STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET}
      - INTERNAL_API_KEY=${INTERNAL_API_KEY}
    depends_on:
      - postgres
      - redis
    networks:
      - tymoe-network

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: tymoe_subscription
      POSTGRES_USER: subscription_user
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - tymoe-network

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    networks:
      - tymoe-network

volumes:
  postgres_data:
  redis_data:

networks:
  tymoe-network:
    driver: bridge
```

### 📊 监控与日志

#### 健康检查端点
```typescript
// /healthz endpoint
app.get('/healthz', async (req, res) => {
  try {
    // 检查数据库连接
    await prisma.$queryRaw`SELECT 1`;
    
    // 检查Redis连接
    await redis.ping();
    
    // 检查Stripe连接（可选）
    await stripe.balance.retrieve();
    
    res.json({ 
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version
    });
  } catch (error) {
    res.status(503).json({ 
      status: 'unhealthy',
      error: error.message 
    });
  }
});
```

### 🔧 运维脚本

#### 数据迁移脚本
```bash
#!/bin/bash
# scripts/migrate.sh

echo "Running database migrations..."

# 1. 备份数据库
pg_dump $DATABASE_URL > "backup_$(date +%Y%m%d_%H%M%S).sql"

# 2. 运行迁移
npx prisma migrate deploy

# 3. 验证迁移
npx prisma migrate status

echo "Migration completed successfully!"
```

#### 缓存清理脚本
```bash
#!/bin/bash
# scripts/clear-cache.sh

echo "Clearing subscription cache..."

# 连接Redis并清理缓存
redis-cli -h $REDIS_HOST -p $REDIS_PORT << EOF
FLUSHDB
EOF

echo "Cache cleared successfully!"
```

## 开发指南

### 🛠️ 开发环境设置

#### 1. **本地开发工具**
```bash
# 安装全局工具
npm install -g tsx prisma stripe-cli

# VS Code插件推荐
code --install-extension Prisma.prisma
code --install-extension ms-vscode.vscode-typescript-next
```

#### 2. **Stripe本地测试**
```bash
# 安装Stripe CLI
brew install stripe/stripe-cli/stripe

# 登录Stripe
stripe login

# 转发Webhook到本地
stripe listen --forward-to localhost:8088/api/webhooks/stripe
```

#### 3. **开发流程**
```bash
# 1. 启动数据库和Redis
docker-compose up postgres redis

# 2. 运行数据库迁移
npm run migrate

# 3. 启动开发服务器
npm run dev

# 4. 在另一个终端启动Stripe监听
stripe listen --forward-to localhost:8088/api/webhooks/stripe
```

### 🧪 测试策略

#### 单元测试示例
```javascript
// tests/services/subscription.test.js
import { describe, test, expect, beforeEach } from '@jest/globals';
import { SubscriptionService } from '../src/services/subscription.js';

describe('SubscriptionService', () => {
  let subscriptionService;

  beforeEach(() => {
    subscriptionService = new SubscriptionService();
  });

  test('should create trial subscription', async () => {
    const subscription = await subscriptionService.createTrialSubscription('org-123', 'ploml');
    
    expect(subscription).toBeDefined();
    expect(subscription.tier).toBe('trial');
    expect(subscription.status).toBe('trialing');
    expect(subscription.productKey).toBe('ploml');
  });

  test('should check feature access correctly', () => {
    const hasAccess = subscriptionService.hasFeatureAccess('ploml', 'basic', 'appointment_booking');
    expect(hasAccess).toBe(true);
    
    const noAccess = subscriptionService.hasFeatureAccess('ploml', 'trial', 'multi_location');
    expect(noAccess).toBe(false);
  });
});
```

#### 集成测试
```javascript
// tests/api/subscriptions.test.js
import request from 'supertest';
import { app } from '../src/app.js';

describe('Subscription API', () => {
  test('POST /api/subscriptions/trial should create trial subscription', async () => {
    const response = await request(app)
      .post('/api/subscriptions/trial')
      .set('X-API-Key', process.env.TEST_API_KEY)
      .send({
        organizationId: 'test-org-123',
        productKey: 'ploml'
      });
    
    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.subscription.tier).toBe('trial');
  });
});
```

### 📝 代码规范

#### TypeScript规范
```typescript
// 接口定义
interface CreateTrialSubscriptionRequest {
  organizationId: string;
  productKey: 'ploml' | 'mopai';
}

interface SubscriptionResponse {
  success: true;
  data: {
    subscription: {
      id: string;
      organizationId: string;
      productKey: string;
      tier: string;
      status: string;
      features: string[];
    };
  };
}

// Service类实现
export class SubscriptionService {
  private readonly prisma = prisma;
  private readonly stripe = stripeService;
  private readonly cache = cacheService;

  async createTrialSubscription(
    organizationId: string, 
    productKey: string
  ): Promise<Subscription> {
    // 1. 验证输入
    this.validateTrialRequest(organizationId, productKey);
    
    // 2. 检查组织是否已使用试用
    await this.checkTrialEligibility(organizationId);
    
    // 3. 创建试用订阅
    const subscription = await this.prisma.subscription.create({
      data: {
        organizationId,
        productKey,
        tier: 'trial',
        status: 'trialing',
        trialEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30天后
      }
    });
    
    // 4. 清理缓存
    await this.cache.delete(`org_cache:${organizationId}`);
    
    return subscription;
  }
}
```

## 故障排除

### 🔍 常见问题

#### 1. **Stripe Webhook验证失败**
```bash
# 检查Webhook签名
curl -X POST localhost:8088/api/webhooks/stripe \
  -H "stripe-signature: invalid_signature" \
  -d "{}"

# 解决方案：
# 1. 确认STRIPE_WEBHOOK_SECRET配置正确
# 2. 检查Webhook端点URL是否正确
# 3. 验证Stripe CLI转发是否正常
```

#### 2. **Redis连接问题**
```bash
# 检查Redis连接
redis-cli ping

# 检查配置
echo $REDIS_URL
echo $REDIS_PASSWORD

# 解决方案：
# 1. 确认Redis服务运行正常
# 2. 检查网络连接和防火墙设置
# 3. 验证认证配置
```

#### 3. **订阅状态同步问题**
```bash
# 手动同步订阅状态
curl -X POST localhost:8088/api/admin/sync-subscriptions \
  -H "X-API-Key: admin-api-key"

# 检查Stripe订阅状态
stripe subscriptions list --customer cus_customer_id
```

#### 4. **功能权限配置错误**
```typescript
// 调试功能权限
const features = getTierFeatures('ploml', 'basic');
console.log('Basic tier features:', features);

const hasAccess = hasFeatureAccess('ploml', 'basic', 'staff_scheduling');
console.log('Has staff_scheduling access:', hasAccess);
```

### 📞 支持与维护

#### 日志查看
```bash
# 查看应用日志
docker-compose logs -f subscription-service

# 查看特定错误
docker-compose logs subscription-service | grep ERROR

# 查看Stripe相关日志
docker-compose logs subscription-service | grep "Stripe"
```

#### 数据库维护
```bash
# 查看订阅统计
psql $DATABASE_URL -c "
SELECT 
  product_key,
  tier,
  status,
  COUNT(*) as count
FROM subscriptions 
GROUP BY product_key, tier, status
ORDER BY product_key, tier;
"

# 清理过期试用订阅
psql $DATABASE_URL -c "
UPDATE subscriptions 
SET status = 'expired' 
WHERE tier = 'trial' 
  AND trial_end < NOW() 
  AND status = 'trialing';
"
```

### 联系方式

- **技术支持**: tech@tymoe.com
- **计费问题**: billing@tymoe.com
- **安全问题**: security@tymoe.com
- **文档更新**: 请提交GitHub Issue

## 📝 快速参考

```bash
# 创建组织
curl -X POST http://localhost:8088/api/organizations \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"id":"org-123","name":"测试公司","email":"admin@company.com"}'

# 创建试用订阅
curl -X POST http://localhost:8088/api/subscriptions/trial \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"organizationId":"org-123","productKey":"ploml"}'

# 获取订阅信息（缓存优化）
curl http://localhost:8088/api/organizations/org-123/cache-info \
  -H "X-API-Key: your-api-key"

# 健康检查
curl http://localhost:8088/healthz
```

---

**🏢 服务定位**: 订阅管理与计费中心  
**🔌 服务端口**: 8088  
**📅 最后更新**: 2024年9月15日  
**🔖 版本**: v0.2.1