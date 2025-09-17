# Tymoe Subscription Service

> **订阅管理与计费中心** - 基于Stripe的企业级订阅管理服务

## 🌐 服务概述

**服务职责**: Subscription Service 负责管理 Tymoe SaaS 平台的订阅计费、功能权限控制和用户自主订阅管理
**技术栈**: Node.js + TypeScript + Express + Prisma + Stripe API
**服务端口**: 8088
**基础URL**: `http://localhost:8088/api/subscription-service/v1`

⚠️ **重要提醒**: 请勿直接修改数据库内容！所有数据操作必须通过API接口进行！

## 🏢 在Tymoe生态中的位置

### 服务间关系图
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   auth-service  │    │subscription-    │    │  ploml/mopai   │
│   (用户认证)     │◄──►│   service       │◄──►│   (业务服务)    │
│   Port: 8087    │    │  (订阅管理)      │    │                │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                         ┌─────────────────┐
                         │     Stripe      │
                         │   (支付平台)     │
                         └─────────────────┘
```

### 职责分工

1. **auth-service**
   - 用户注册/登录/JWT签发
   - 店铺(Organization)创建和管理
   - 用户权限验证

2. **subscription-service** (本服务)
   - 订阅状态管理
   - 功能权限验证
   - Stripe支付集成
   - 计费周期管理

3. **ploml/mopai-service**
   - 具体业务功能
   - 调用subscription-service检查权限
   - 根据订阅状态提供服务

4. **Stripe**
   - 支付处理
   - 订阅计费
   - Webhook通知

## 📖 目录

- [服务概述](#服务概述)
- [在Tymoe生态中的位置](#在tymoe生态中的位置)
- [快速开始](#快速开始)
- [API接口详解](#api接口详解)
  - [用户前端API](#用户前端api-需要jwt认证)
  - [管理员API](#管理员api-需要内部api密钥)
  - [Webhook接口](#webhook接口)
- [数据库架构](#数据库架构)
- [功能权限体系](#功能权限体系)
- [认证与安全](#认证与安全)
- [开发指南](#开发指南)
- [部署运维](#部署运维)
- [故障排除](#故障排除)

## 🚀 快速开始

### 1. 安装依赖
```bash
npm install
```

### 2. 环境配置
复制环境变量文件：
```bash
cp .env.example .env
```

配置必要的环境变量：
```bash
# 数据库
DATABASE_URL=postgresql://user:password@localhost:5432/subscription_service

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Auth Service
AUTH_SERVICE_URL=http://localhost:8087

# 内部API密钥
INTERNAL_API_KEY=your-secure-key
```

### 3. 数据库设置
```bash
npx prisma migrate dev
npx prisma generate
```

### 4. 启动服务
```bash
# 开发模式
npm run dev

# 生产模式
npm run build
npm start
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

## 🎯 API接口详解

### 用户前端API (需要JWT认证)

所有用户API都需要在请求头中携带JWT token：
```
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
```

#### 1. 获取组织订阅状态

**端点**: `GET /organizations/{organizationId}/subscription-status`

**用途**: 用户选择店铺后立即调用，获取完整订阅状态并用于前端缓存

**请求示例**:
```bash
curl -X GET http://localhost:8088/api/subscription-service/v1/organizations/org-123/subscription-status \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIs..."
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "organizationId": "org-123",
    "organizationName": "美丽沙龙",
    "subscriptions": [
      {
        "id": "sub-456",
        "productKey": "ploml",
        "tier": "basic",
        "status": "active",
        "currentPeriodStart": "2024-01-15T00:00:00Z",
        "currentPeriodEnd": "2024-02-15T23:59:59Z",
        "trialEnd": null,
        "cancelAtPeriodEnd": false,
        "features": [
          "appointment_booking",
          "customer_management",
          "service_catalog",
          "basic_reports"
        ]
      }
    ],
    "lastUpdated": "2024-01-20T10:30:00Z"
  }
}
```

#### 2. 检查功能权限

**端点**: `GET /organizations/{organizationId}/products/{productKey}/features/{featureKey}/access`

**用途**: 当缓存显示无权限时，实时检查最新权限状态

**请求示例**:
```bash
curl -X GET http://localhost:8088/api/subscription-service/v1/organizations/org-123/products/ploml/features/advanced_reports/access \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIs..."
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "hasAccess": false,
    "currentTier": "basic",
    "featureKey": "advanced_reports",
    "requiresMinimumTier": "standard"
  }
}
```

#### 3. 获取产品定价

**端点**: `GET /products/{productKey}/pricing`

**用途**: 显示升级页面时获取定价信息

**请求示例**:
```bash
curl -X GET http://localhost:8088/api/subscription-service/v1/products/ploml/pricing \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIs..."
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "productKey": "ploml",
    "pricing": [
      {
        "tier": "basic",
        "billingCycle": "monthly",
        "amount": 2900,
        "currency": "usd",
        "features": ["appointment_booking", "customer_management"]
      },
      {
        "tier": "standard",
        "billingCycle": "monthly",
        "amount": 4900,
        "currency": "usd",
        "features": ["appointment_booking", "customer_management", "advanced_reports"]
      }
    ]
  }
}
```

#### 4. 开始试用

**端点**: `POST /organizations/{organizationId}/subscriptions/start-trial`

**用途**: 用户一键开始30天免费试用

**请求示例**:
```bash
curl -X POST http://localhost:8088/api/subscription-service/v1/organizations/org-123/subscriptions/start-trial \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIs..." \
  -H "Content-Type: application/json" \
  -d '{
    "productKey": "ploml"
  }'
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "subscription": {
      "id": "sub-789",
      "organizationId": "org-123",
      "productKey": "ploml",
      "tier": "trial",
      "status": "trialing",
      "trialEnd": "2024-02-20T23:59:59Z"
    },
    "trialPeriodDays": 30,
    "features": [
      "appointment_booking",
      "customer_management",
      "service_catalog"
    ],
    "message": "试用已开始，享受30天免费体验！"
  }
}
```

#### 5. 创建支付会话（订阅付费版）

**端点**: `POST /organizations/{organizationId}/subscriptions/checkout`

**用途**: 用户选择付费套餐，创建Stripe支付链接

**请求示例**:
```bash
curl -X POST http://localhost:8088/api/subscription-service/v1/organizations/org-123/subscriptions/checkout \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIs..." \
  -H "Content-Type: application/json" \
  -d '{
    "productKey": "ploml",
    "tier": "basic",
    "billingCycle": "monthly",
    "successUrl": "https://ploml.com/success",
    "cancelUrl": "https://ploml.com/cancel"
  }'
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "checkoutUrl": "https://checkout.stripe.com/pay/cs_test_123...",
    "message": "请完成支付以激活订阅"
  }
}
```

#### 6. 升级订阅

**端点**: `POST /organizations/{organizationId}/subscriptions/upgrade`

**用途**: 用户升级到更高套餐

**请求示例**:
```bash
curl -X POST http://localhost:8088/api/subscription-service/v1/organizations/org-123/subscriptions/upgrade \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIs..." \
  -H "Content-Type: application/json" \
  -d '{
    "productKey": "ploml",
    "newTier": "standard",
    "billingCycle": "monthly",
    "successUrl": "https://ploml.com/upgrade-success",
    "cancelUrl": "https://ploml.com/upgrade-cancel"
  }'
```

**响应示例（需要支付）**:
```json
{
  "success": true,
  "data": {
    "requiresPayment": true,
    "checkoutUrl": "https://checkout.stripe.com/pay/cs_test_456...",
    "message": "请完成支付以升级订阅"
  }
}
```

**响应示例（直接升级）**:
```json
{
  "success": true,
  "data": {
    "requiresPayment": false,
    "subscription": {
      "id": "sub-456",
      "tier": "standard",
      "status": "active"
    },
    "features": [
      "appointment_booking",
      "customer_management",
      "service_catalog",
      "advanced_reports"
    ],
    "message": "订阅已成功升级！"
  }
}
```

#### 7. 取消订阅

**端点**: `POST /organizations/{organizationId}/subscriptions/cancel`

**用途**: 用户取消订阅

**请求示例**:
```bash
curl -X POST http://localhost:8088/api/subscription-service/v1/organizations/org-123/subscriptions/cancel \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIs..." \
  -H "Content-Type: application/json" \
  -d '{
    "productKey": "ploml",
    "cancelAtPeriodEnd": true
  }'
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "subscription": {
      "id": "sub-456",
      "status": "active",
      "cancelAtPeriodEnd": true,
      "currentPeriodEnd": "2024-02-15T23:59:59Z"
    }
  },
  "message": "订阅将在当前计费周期结束时取消，在此之前您仍可使用所有功能"
}
```

### 管理员API (需要内部API密钥)

所有管理员API都需要在请求头中携带内部API密钥：
```
X-API-Key: your-internal-api-key
```

#### 1. 组织管理

**创建组织**: `POST /admin/organizations`

**请求示例**:
```bash
curl -X POST http://localhost:8088/api/subscription-service/v1/admin/organizations \
  -H "X-API-Key: your-internal-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "org-456",
    "name": "时尚理发店",
    "email": "admin@fashionhair.com"
  }'
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "organization": {
      "id": "org-456",
      "name": "时尚理发店",
      "stripeCustomerId": null,
      "hasUsedTrial": false,
      "createdAt": "2024-01-20T10:30:00Z"
    }
  }
}
```

**获取组织信息**: `GET /admin/organizations/{organizationId}`

**更新组织信息**: `PATCH /admin/organizations/{organizationId}`

**删除组织**: `DELETE /admin/organizations/{organizationId}`

#### 2. 订阅管理

**创建试用订阅**: `POST /admin/subscriptions/trial`

**创建付费订阅**: `POST /admin/subscriptions/paid`

**升级订阅**: `PATCH /admin/subscriptions/{subscriptionId}/upgrade`

**取消订阅**: `PATCH /admin/subscriptions/{subscriptionId}/cancel`

### Webhook接口

#### Stripe Webhook

**端点**: `POST /webhooks/stripe`

**用途**: 接收Stripe的支付状态通知，自动更新订阅状态

**配置要求**:
```bash
# Stripe CLI配置
stripe listen --forward-to localhost:8088/api/subscription-service/v1/webhooks/stripe
```

**处理的事件类型**:
- `checkout.session.completed` - 支付完成
- `invoice.payment_succeeded` - 续费成功
- `invoice.payment_failed` - 续费失败
- `customer.subscription.updated` - 订阅更新
- `customer.subscription.deleted` - 订阅取消

## 🗄️ 数据库架构

### 核心数据模型

```prisma
// 组织表（店铺）
model Organization {
  id                String   @id @default(cuid())
  name              String
  stripeCustomerId  String?  @unique
  hasUsedTrial      Boolean  @default(false)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  subscriptions     Subscription[]
}

// 产品表（ploml/mopai）
model Product {
  key       String   @id // "ploml" | "mopai"
  name      String   // "Ploml Beauty Management"
  active    Boolean  @default(true)

  subscriptions Subscription[]
  prices        Price[]
}

// 订阅表
model Subscription {
  id                    String    @id @default(cuid())
  organizationId        String
  productKey            String
  tier                  String    // "trial" | "basic" | "standard" | "advanced" | "pro"
  status                String    // "trialing" | "active" | "past_due" | "canceled"
  billingCycle          String?   // "monthly" | "yearly"
  currentPeriodStart    DateTime?
  currentPeriodEnd      DateTime?
  trialEnd              DateTime?
  stripeSubscriptionId  String?   @unique
  stripePriceId         String?
  cancelAtPeriodEnd     Boolean   @default(false)

  organization Organization @relation(fields: [organizationId], references: [id])
  product      Product      @relation(fields: [productKey], references: [key])
}

// 价格表（Stripe价格配置）
model Price {
  id            String  @id @default(cuid())
  stripePriceId String  @unique
  productKey    String
  tier          String  // "basic" | "standard" | "advanced" | "pro"
  billingCycle  String  // "monthly" | "yearly"
  amount        Int     // 价格（分）
  currency      String  @default("usd")
  active        Boolean @default(true)

  product       Product        @relation(fields: [productKey], references: [key])
  subscriptions Subscription[]
}
```

### 数据关系图

```
Organization (店铺)
    ├── hasUsedTrial (是否使用过试用)
    ├── stripeCustomerId (Stripe客户ID)
    └── Subscription[] (订阅列表)
            ├── Product (ploml/mopai)
            ├── tier (套餐等级)
            ├── status (订阅状态)
            └── Price (价格配置)
                    └── Stripe Price (Stripe价格对象)
```

## ⚡ 功能权限体系

### 产品线功能对比

#### Ploml (美业管理)

| 功能 | Trial | Basic | Standard | Advanced | Pro |
|------|-------|-------|----------|----------|-----|
| 预约管理 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 客户管理 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 服务项目管理 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 基础报表 | ❌ | ✅ | ✅ | ✅ | ✅ |
| 高级报表 | ❌ | ❌ | ✅ | ✅ | ✅ |
| 多店铺管理 | ❌ | ❌ | ❌ | ✅ | ✅ |
| API访问 | ❌ | ❌ | ❌ | ❌ | ✅ |
| 自定义字段 | ❌ | ❌ | ❌ | ❌ | ✅ |

#### Mopai (餐饮管理)

| 功能 | Trial | Basic | Standard | Advanced | Pro |
|------|-------|-------|----------|----------|-----|
| 点餐管理 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 桌台管理 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 菜单管理 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 基础报表 | ❌ | ✅ | ✅ | ✅ | ✅ |
| 库存管理 | ❌ | ❌ | ✅ | ✅ | ✅ |
| 多门店管理 | ❌ | ❌ | ❌ | ✅ | ✅ |
| 第三方集成 | ❌ | ❌ | ❌ | ❌ | ✅ |

### 权限检查逻辑

```typescript
// 功能权限检查示例
function hasFeatureAccess(productKey: string, tier: string, feature: string): boolean {
  const features = {
    ploml: {
      trial: ['appointment_booking', 'customer_management', 'service_catalog'],
      basic: ['appointment_booking', 'customer_management', 'service_catalog', 'basic_reports'],
      standard: ['appointment_booking', 'customer_management', 'service_catalog', 'basic_reports', 'advanced_reports'],
      // ...
    },
    mopai: {
      // ...
    }
  };

  return features[productKey]?.[tier]?.includes(feature) || false;
}
```

## 🔐 认证与安全

### 双重认证体系

#### 1. JWT认证（用户API）

- **用途**: 前端用户调用
- **验证流程**:
  1. 从请求头获取JWT token
  2. 使用auth-service公钥验证签名
  3. 检查token有效期
  4. 验证用户对组织的权限

#### 2. API密钥认证（管理员API）

- **用途**: 服务间调用、管理后台
- **验证流程**:
  1. 从请求头获取API密钥
  2. 与配置的内部密钥比较
  3. 验证通过后拥有完整权限

### 安全措施

1. **数据隔离**: 用户只能访问自己拥有的组织数据
2. **权限验证**: 每次请求都验证用户对组织的权限
3. **敏感信息保护**: Stripe信息通过Webhook异步更新
4. **审计日志**: 记录所有重要操作
5. **HTTPS强制**: 生产环境强制使用HTTPS

## 🏗️ 开发指南

### 服务架构

订阅服务采用分层架构设计：

- **`src/index.ts`** - 主入口点，负责应用启动、错误处理和进程管理
- **`src/server.ts`** - 服务器启动模块，处理数据库/Redis连接和优雅关闭
- **`src/app.ts`** - Express应用配置，定义路由和中间件

### 🔐 认证架构

#### JWT验证流程
```
前端请求 → JWT验证中间件 → 组织权限验证 → 业务逻辑 → 返回结果
```

#### 服务间调用流程
```
内部服务 → API密钥验证 → 业务逻辑 → 返回结果
```

### 🛠️ 开发环境设置

#### 1. 本地开发工具
```bash
# 安装全局工具
npm install -g tsx prisma

# 安装Stripe CLI
brew install stripe/stripe-cli/stripe
```

#### 2. 数据库开发
```bash
# 生成Prisma客户端
npm run prisma:gen

# 运行数据库迁移
npm run prisma:migrate

# 打开数据库管理界面
npm run prisma:studio
```

#### 3. 开发流程
```bash
# 1. 启动数据库和Redis
docker-compose up postgres redis

# 2. 运行数据库迁移
npm run prisma:migrate

# 3. 启动开发服务器
npm run dev

# 4. 在另一个终端启动Stripe监听
stripe listen --forward-to localhost:8088/api/subscription-service/v1/webhooks/stripe
```

### 🧪 测试策略

#### 代码质量检查
```bash
# TypeScript类型检查
npm run typecheck

# 编译检查
npm run build
```

#### API测试示例
```bash
# 测试健康检查
curl http://localhost:8088/health

# 测试用户API（需要有效JWT）
curl -X GET http://localhost:8088/api/subscription-service/v1/organizations/org-123/subscription-status \
  -H "Authorization: Bearer valid-jwt-token"

# 测试管理员API
curl -X GET http://localhost:8088/api/subscription-service/v1/admin/organizations/org-123 \
  -H "X-API-Key: your-internal-api-key"
```

## 🚀 部署运维

### 环境变量配置

| 变量名 | 说明 | 示例 | 必需 |
|--------|------|------|------|
| `NODE_ENV` | 运行环境 | `production` | ✅ |
| `PORT` | 服务端口 | `8088` | ✅ |
| `DATABASE_URL` | 数据库连接 | `postgresql://...` | ✅ |
| `REDIS_URL` | Redis连接 | `redis://localhost:6379/1` | ✅ |
| `STRIPE_SECRET_KEY` | Stripe密钥 | `sk_live_...` | ✅ |
| `STRIPE_WEBHOOK_SECRET` | Webhook密钥 | `whsec_...` | ✅ |
| `AUTH_SERVICE_URL` | Auth服务地址 | `http://auth-service:8087` | ✅ |
| `INTERNAL_API_KEY` | 内部API密钥 | `secure-random-key` | ✅ |
| `CORS_ORIGIN` | CORS来源 | `https://ploml.com` | ❌ |
| `LOG_LEVEL` | 日志级别 | `info` | ❌ |

### Docker部署

```bash
# 构建镜像
docker build -t subscription-service .

# 运行容器
docker run -d \
  --name subscription-service \
  -p 8088:8088 \
  --env-file .env \
  --network tymoe-network \
  subscription-service
```

### Docker Compose

```yaml
version: '3.8'
services:
  subscription-service:
    build: .
    ports:
      - "8088:8088"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://postgres:password@postgres:5432/subscription_service
      - REDIS_URL=redis://redis:6379/1
      - AUTH_SERVICE_URL=http://auth-service:8087
    depends_on:
      - postgres
      - redis
      - auth-service
    networks:
      - tymoe-network

  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: subscription_service
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - tymoe-network

  redis:
    image: redis:7-alpine
    networks:
      - tymoe-network

networks:
  tymoe-network:
    driver: bridge

volumes:
  postgres_data:
```

### 监控指标

#### 性能指标
- **响应时间**: 95%请求 < 200ms
- **可用性**: 99.9%
- **错误率**: < 0.1%
- **Stripe延迟**: webhook < 5秒处理

#### 业务指标
- **订阅转化率**: 试用 → 付费
- **升级率**: 基础版 → 高级版
- **流失率**: 取消订阅率
- **收入增长**: 月度/年度收入

### 日志管理

```bash
# 查看服务日志
docker logs -f subscription-service

# 查看特定时间段日志
docker logs subscription-service --since="2024-01-20T10:00:00" --until="2024-01-20T11:00:00"

# 过滤错误日志
docker logs subscription-service 2>&1 | grep "ERROR"
```

## 🚨 故障排除

### 常见问题

#### 1. JWT验证失败
**问题**: `401 Unauthorized - JWT token无效`

**解决方案**:
```bash
# 检查auth-service是否正常
curl http://localhost:8087/health

# 检查JWT token格式
echo "Bearer eyJhbGciOiJSUzI1NiIs..." | base64 -d

# 验证auth-service公钥获取
curl http://localhost:8087/api/auth/public-key \
  -H "X-API-Key: internal-key"
```

#### 2. Stripe Webhook失败
**问题**: 支付完成但订阅状态未更新

**解决方案**:
```bash
# 检查Stripe CLI连接
stripe listen --list

# 验证webhook密钥
stripe events retrieve evt_xxx

# 重新配置webhook
stripe listen --forward-to localhost:8088/api/subscription-service/v1/webhooks/stripe
```

#### 3. 数据库连接问题
**问题**: `Database connection failed`

**解决方案**:
```bash
# 检查数据库连接
psql $DATABASE_URL -c "SELECT 1"

# 运行数据库迁移
npx prisma migrate reset
npx prisma migrate deploy

# 检查数据库状态
npx prisma db seed
```

#### 4. Redis连接问题
**问题**: `Redis connection timeout`

**解决方案**:
```bash
# 检查Redis连接
redis-cli -u $REDIS_URL ping

# 重启Redis服务
docker restart redis

# 清除Redis缓存
redis-cli -u $REDIS_URL flushall
```

### 错误代码参考

| 错误代码 | HTTP状态码 | 说明 | 解决方案 |
|----------|-----------|------|----------|
| `unauthorized` | 401 | JWT token无效或过期 | 重新登录获取新token |
| `access_denied` | 403 | 用户无权访问该组织 | 检查用户权限 |
| `subscription_not_found` | 404 | 订阅不存在 | 先创建订阅 |
| `trial_already_used` | 409 | 已使用过试用期 | 直接订阅付费版 |
| `invalid_product` | 400 | 产品类型错误 | 使用ploml或mopai |
| `server_error` | 500 | 服务器内部错误 | 查看日志排查 |

### 性能优化建议

1. **缓存策略**
   - JWT公钥缓存1小时
   - 订阅状态缓存15分钟
   - 功能权限缓存5分钟

2. **数据库优化**
   - 为常用查询添加索引
   - 使用连接池
   - 定期清理过期数据

3. **监控告警**
   - 设置响应时间告警
   - 监控数据库连接数
   - 跟踪Stripe webhook延迟

---

**相关文档**:
- [前端集成指南](./README_for_frontend.md)

**技术支持**: 如遇问题请查看日志或联系开发团队