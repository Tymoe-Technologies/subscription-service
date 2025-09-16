# Tymoe Subscription Service

## 📋 概述

Tymoe Subscription Service 是一个基于 Node.js + TypeScript 的企业级订阅管理服务，为 Tymoe SaaS 平台提供统一的订阅计费、功能权限控制和客户管理功能。

## 最新更新 ✨

### v0.2.1 类型安全和稳定性提升

1. **TypeScript类型安全增强**
   - 修复所有控制器函数的返回类型注解
   - 解决Redis配置类型兼容性问题
   - 优化Stripe API版本兼容性
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

### 🎯 核心功能

- **多产品订阅管理**：支持 ploml（美业）和 mopai（餐饮）两个产品线
- **分级订阅套餐**：Trial → Basic → Standard → Advanced → Pro 五个等级
- **功能权限控制**：细粒度的功能级别权限管理
- **Stripe 集成**：完整的支付和计费管理
- **前端缓存优化**：专为前端性能优化的缓存API
- **企业级安全**：内部API密钥验证，审计日志

### 🏗️ 技术架构

- **后端**：Node.js + TypeScript + Express
- **数据库**：PostgreSQL + Prisma ORM
- **缓存**：Redis
- **支付**：Stripe API
- **部署**：Docker + Docker Compose
- **代码质量**：ESLint + Prettier

## 🚀 快速开始

### 环境要求

- Node.js 18+
- PostgreSQL 14+
- Redis 6+
- Docker & Docker Compose（可选）

### 安装和运行

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env 文件填入正确配置

# 3. 数据库初始化
npm run prisma:generate
npm run prisma:migrate

# 4. 启动开发服务器
npm run dev

# 5. 生产环境部署
npm run build
npm start
```

### Docker 部署

```bash
# 使用 Docker Compose 一键启动
docker-compose up -d

# 运行数据库迁移
docker-compose exec subscription-service npm run prisma:migrate
```

## 🛣️ API 路由详解

### 基础信息

- **服务端口**：8088
- **API 前缀**：`/api`
- **认证方式**：内部 API 密钥（`X-API-Key` 请求头）

### 🏢 组织管理路由 `/api/organizations`

#### POST `/api/organizations`
**创建组织**
```bash
curl -X POST 'http://localhost:8088/api/organizations' \
  -H 'X-API-Key: your-api-key' \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "org-from-auth-service",
    "name": "测试美容院",
    "email": "contact@salon.com"
  }'
```

#### GET `/api/organizations`
**获取组织列表（管理员用）**
```bash
curl 'http://localhost:8088/api/organizations?page=1&limit=20' \
  -H 'X-API-Key: your-api-key'
```

#### GET `/api/organizations/{organizationId}`
**获取组织详情**
```bash
curl 'http://localhost:8088/api/organizations/org-123' \
  -H 'X-API-Key: your-api-key'
```

#### GET `/api/organizations/{organizationId}/subscriptions`
**获取组织及其订阅信息**
```bash
curl 'http://localhost:8088/api/organizations/org-123/subscriptions' \
  -H 'X-API-Key: your-api-key'
```

返回格式：
```json
{
  "success": true,
  "data": {
    "organization": {
      "id": "org-123",
      "name": "测试美容院",
      "subscriptions": [
        {
          "id": "sub-456",
          "productKey": "ploml",
          "tier": "basic",
          "status": "active",
          "features": ["appointment_booking", "customer_management"],
          "isActive": true
        }
      ]
    }
  }
}
```

#### GET `/api/organizations/{organizationId}/cache-info` 🚀
**获取组织缓存信息（前端专用）**
```bash
curl 'http://localhost:8088/api/organizations/org-123/cache-info' \
  -H 'X-API-Key: your-api-key'
```

返回格式：
```json
{
  "success": true,
  "data": {
    "organizationId": "org-123",
    "subscriptions": {
      "ploml": {
        "tier": "basic",
        "status": "active",
        "expiresAt": "2024-02-15T23:59:59Z",
        "isActive": true,
        "features": ["appointment_booking", "customer_management"]
      },
      "mopai": {
        "tier": null,
        "status": "none",
        "isActive": false,
        "features": []
      }
    },
    "cacheValidUntil": "2024-01-15T10:30:00Z",
    "lastUpdated": "2024-01-15T10:00:00Z"
  }
}
```

#### PATCH `/api/organizations/{organizationId}`
**更新组织信息**
```bash
curl -X PATCH 'http://localhost:8088/api/organizations/org-123' \
  -H 'X-API-Key: your-api-key' \
  -H 'Content-Type: application/json' \
  -d '{"name": "新的美容院名称"}'
```

#### GET `/api/organizations/{organizationId}/trial-status`
**获取试用状态**
```bash
curl 'http://localhost:8088/api/organizations/org-123/trial-status' \
  -H 'X-API-Key: your-api-key'
```

#### DELETE `/api/organizations/{organizationId}`
**删除组织**
```bash
curl -X DELETE 'http://localhost:8088/api/organizations/org-123' \
  -H 'X-API-Key: your-api-key'
```

### 📦 订阅管理路由 `/api/subscriptions`

#### POST `/api/subscriptions/trial`
**创建试用订阅**
```bash
curl -X POST 'http://localhost:8088/api/subscriptions/trial' \
  -H 'X-API-Key: your-api-key' \
  -H 'Content-Type: application/json' \
  -d '{
    "organizationId": "org-123",
    "productKey": "ploml"
  }'
```

#### POST `/api/subscriptions/paid`
**创建付费订阅**
```bash
curl -X POST 'http://localhost:8088/api/subscriptions/paid' \
  -H 'X-API-Key: your-api-key' \
  -H 'Content-Type: application/json' \
  -d '{
    "organizationId": "org-123",
    "productKey": "ploml",
    "tier": "basic",
    "billingCycle": "monthly",
    "successUrl": "https://app.com/success",
    "cancelUrl": "https://app.com/cancel"
  }'
```

#### PATCH `/api/subscriptions/{subscriptionId}/upgrade`
**升级订阅**
```bash
curl -X PATCH 'http://localhost:8088/api/subscriptions/sub-456/upgrade' \
  -H 'X-API-Key: your-api-key' \
  -H 'Content-Type: application/json' \
  -d '{
    "newTier": "standard",
    "billingCycle": "yearly"
  }'
```

#### PATCH `/api/subscriptions/{subscriptionId}/cancel`
**取消订阅**
```bash
curl -X PATCH 'http://localhost:8088/api/subscriptions/sub-456/cancel' \
  -H 'X-API-Key: your-api-key' \
  -H 'Content-Type: application/json' \
  -d '{"cancelAtPeriodEnd": true}'
```

#### GET `/api/subscriptions/{subscriptionId}`
**获取订阅详情**
```bash
curl 'http://localhost:8088/api/subscriptions/sub-456' \
  -H 'X-API-Key: your-api-key'
```

#### GET `/api/subscriptions/organization/{organizationId}/product/{productKey}`
**获取组织的特定产品订阅**
```bash
curl 'http://localhost:8088/api/subscriptions/organization/org-123/product/ploml' \
  -H 'X-API-Key: your-api-key'
```

#### GET `/api/subscriptions/organization/{organizationId}`
**获取组织的所有订阅**
```bash
curl 'http://localhost:8088/api/subscriptions/organization/org-123' \
  -H 'X-API-Key: your-api-key'
```

#### GET `/api/subscriptions/organization/{organizationId}/product/{productKey}/feature/{featureKey}` 🔐
**检查功能权限**
```bash
curl 'http://localhost:8088/api/subscriptions/organization/org-123/product/ploml/feature/analytics_reports' \
  -H 'X-API-Key: your-api-key'
```

返回格式：
```json
{
  "success": true,
  "data": {
    "hasAccess": false,
    "tier": "basic",
    "reason": "tier_restriction",
    "message": "当前套餐不支持该功能"
  }
}
```

#### GET `/api/subscriptions/pricing/{productKey}`
**获取产品定价**
```bash
curl 'http://localhost:8088/api/subscriptions/pricing/ploml' \
  -H 'X-API-Key: your-api-key'
```

### 🔔 Webhook 路由 `/api/webhooks`

#### POST `/api/webhooks/stripe`
**Stripe Webhook 处理**
```bash
# 由 Stripe 自动调用，处理支付事件
# 需要配置 Stripe Webhook 密钥
```

### 🏥 系统路由

#### GET `/health`
**健康检查**
```bash
curl 'http://localhost:8088/health'
```

返回：`{"ok": true}`

## 📊 数据模型

### Organization 组织
```sql
model Organization {
  id                String   @id
  name              String
  stripeCustomerId  String?  @unique
  hasUsedTrial      Boolean  @default(false)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  
  subscriptions     Subscription[]
}
```

### Product 产品
```sql
model Product {
  key       String   @id // "ploml" | "mopai" 
  name      String
  active    Boolean  @default(true)
  
  subscriptions Subscription[]
  prices        Price[]
}
```

### Subscription 订阅
```sql
model Subscription {
  id                   String    @id
  organizationId       String
  productKey           String
  tier                 String    // "trial" | "basic" | "standard" | "advanced" | "pro"
  status               String    // "trialing" | "active" | "past_due" | "canceled"
  billingCycle         String?   // "monthly" | "yearly"
  currentPeriodStart   DateTime?
  currentPeriodEnd     DateTime?
  trialEnd             DateTime?
  stripeSubscriptionId String?   @unique
  stripePriceId        String?
  
  organization Organization @relation(fields: [organizationId], references: [id])
  product      Product      @relation(fields: [productKey], references: [key])
}
```

### Price 价格
```sql
model Price {
  id            String  @id
  stripePriceId String  @unique
  productKey    String
  tier          String
  billingCycle  String
  amount        Int     // 价格（分）
  currency      String  @default("usd")
  active        Boolean @default(true)
}
```

## 🎯 功能权限配置

### Ploml（美业）功能
- **Trial/Basic**: `appointment_booking`, `customer_management`, `service_catalog`
- **Standard+**: `staff_scheduling`
- **Advanced+**: `inventory_management`, `analytics_reports`
- **Pro**: `multi_location`, `api_access`, `custom_branding`

### Mopai（餐饮）功能
- **Trial/Basic**: `table_management`, `menu_management`, `order_taking`
- **Standard+**: `kitchen_display`
- **Advanced+**: `inventory_tracking`, `staff_management`
- **Pro**: `multi_restaurant`, `delivery_integration`, `analytics_dashboard`

功能权限配置位于：`src/config/features.ts`

## 🛡️ 安全配置

### 内部API密钥
所有API都需要在请求头中包含：
```
X-API-Key: your-internal-api-key
```

### 环境变量配置
重要的环境变量：
```bash
# 数据库
DATABASE_URL=postgresql://user:password@localhost:5432/subscription_db

# Stripe
STRIPE_SECRET_KEY=sk_live_or_test_key
STRIPE_WEBHOOK_SECRET=whsec_webhook_secret

# 内部API安全
INTERNAL_API_KEY=your-super-secure-api-key

# Redis
REDIS_URL=redis://localhost:6379

# CORS
CORS_ORIGIN=https://app.tymoe.com,https://ploml.com
```

## 🔧 开发和调试

### 代码检查
```bash
# 代码规范检查
npm run lint

# 代码格式化
npm run format

# TypeScript 类型检查
npm run type-check

# 构建项目
npm run build
```

### 数据库管理
```bash
# 生成 Prisma Client
npm run prisma:generate

# 创建迁移
npm run prisma:migrate

# 重置数据库（开发环境）
npm run prisma:reset

# 打开 Prisma Studio
npm run prisma:studio
```

### 测试订阅功能

1. **创建组织**：先通过组织API创建组织
2. **开始试用**：调用试用订阅API
3. **检查权限**：使用功能权限检查API
4. **升级订阅**：测试付费订阅流程
5. **前端缓存**：使用cache-info API测试缓存

### 常用调试命令

```bash
# 查看所有组织
curl 'http://localhost:8088/api/organizations' -H 'X-API-Key: dev-key'

# 查看特定组织的订阅
curl 'http://localhost:8088/api/organizations/org-123/subscriptions' -H 'X-API-Key: dev-key'

# 检查功能权限
curl 'http://localhost:8088/api/subscriptions/organization/org-123/product/ploml/feature/analytics_reports' -H 'X-API-Key: dev-key'

# 获取前端缓存信息
curl 'http://localhost:8088/api/organizations/org-123/cache-info' -H 'X-API-Key: dev-key'
```

## 📁 项目结构

```
subscription-service/
├── src/
│   ├── controllers/          # API 控制器
│   │   ├── organization.ts   # 组织管理
│   │   ├── subscription.ts   # 订阅管理
│   │   └── webhook.ts        # Webhook 处理
│   ├── services/             # 业务逻辑层
│   │   ├── organization.ts
│   │   ├── subscription.ts
│   │   └── stripe.ts
│   ├── routes/               # 路由定义
│   │   ├── organization.ts
│   │   ├── subscription.ts
│   │   └── webhook.ts
│   ├── middleware/           # 中间件
│   │   ├── auth.ts          # API密钥验证
│   │   └── error.ts         # 错误处理
│   ├── config/               # 配置文件
│   │   ├── features.ts      # 功能权限配置
│   │   └── env.ts           # 环境变量
│   ├── infra/               # 基础设施
│   │   ├── prisma.ts        # 数据库连接
│   │   ├── redis.ts         # Redis连接
│   │   └── stripe.ts        # Stripe服务
│   └── types/               # TypeScript类型
├── prisma/
│   └── schema.prisma        # 数据库模型
├── scripts/
│   └── deploy.sh           # 部署脚本
├── README_for_frontend.md   # 前端集成指南
├── package.json
├── tsconfig.json
├── Dockerfile
└── docker-compose.yml
```

## 🚀 部署指南

### Docker 部署（推荐）

1. **构建镜像**
```bash
./scripts/deploy.sh
```

2. **启动服务**
```bash
docker-compose up -d
```

3. **运行迁移**
```bash
docker-compose exec subscription-service npm run prisma:migrate
```

### 环境配置

生产环境需要配置：
- PostgreSQL 数据库
- Redis 缓存
- Stripe API 密钥
- 内部API密钥
- CORS 白名单

### 监控和日志

- **健康检查**：`GET /health`
- **日志位置**：Docker容器内 `/app/logs/`
- **错误监控**：建议集成 Sentry 或类似服务

## 🔗 集成指南

### 与 Auth Service 集成
- Auth Service 创建用户和组织时，调用本服务创建组织记录
- 使用统一的 organizationId 进行关联

### 与业务服务集成
- 业务服务在执行需要权限的操作前，调用权限检查API
- 推荐使用前端缓存机制减少网络请求

### 前端集成
详见 `README_for_frontend.md` 文档，包含完整的前端缓存实现方案。

## 🆘 故障排除

### 常见问题

1. **API返回401错误**
   - 检查 X-API-Key 请求头是否正确
   - 确认环境变量 INTERNAL_API_KEY 配置

2. **数据库连接失败**
   - 检查 DATABASE_URL 配置
   - 确认数据库服务运行正常

3. **Stripe相关错误**
   - 检查 STRIPE_SECRET_KEY 配置
   - 确认 Webhook 密钥正确

4. **权限检查返回意外结果**
   - 检查功能配置 `src/config/features.ts`
   - 确认订阅状态和等级

### 日志查看

```bash
# Docker 环境
docker-compose logs subscription-service

# 本地开发
npm run dev  # 查看控制台输出
```

## 📞 技术支持

- **代码仓库**：[GitHub链接]
- **技术文档**：本 README 文档
- **前端集成**：参考 `README_for_frontend.md`
- **问题报告**：通过 GitHub Issues

---

**版本**: 1.0.0  
**最后更新**: 2024年9月15日  
**维护者**: Tymoe 技术团队