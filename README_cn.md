# 订阅服务 (Subscription Service)

**订阅服务**负责管理 Tymoe 平台的订阅计划、Stripe 集成和订阅状态跟踪。

---

## 📋 目录

- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [API 端点](#api-端点)
- [环境变量](#环境变量)
- [数据库架构](#数据库架构)
- [Stripe 集成](#stripe-集成)
- [开发](#开发)

---

## 🚀 功能特性

- ✅ **订阅计划管理** - 创建和管理多层级订阅计划
- ✅ **Stripe 支付集成** - 处理支付和订阅
- ✅ **订阅状态跟踪** - 监控活跃、取消和过期的订阅
- ✅ **组织订阅** - 将订阅关联到组织
- ✅ **Webhook 处理** - 处理 Stripe webhook 事件
- ✅ **缓存机制** - Redis 缓存用于快速查找订阅状态

---

## 🛠️ 技术栈

- **运行时**: Node.js + TypeScript
- **框架**: Express.js
- **数据库**: PostgreSQL + Prisma ORM
- **缓存**: Redis
- **支付**: Stripe
- **认证**: JWT (通过 Auth Service)

---

## 🎮 快速开始

### 前置要求

- Node.js 18+
- PostgreSQL
- Redis
- Stripe 账户

### 安装

```bash
# 安装依赖
npm install

# 设置环境变量
cp .env.example .env
# 编辑 .env 并填写你的配置

# 运行数据库迁移
npx prisma migrate deploy

# 启动服务
npm run dev
```

---

## 📡 API 端点

### 订阅计划

- `GET /api/subscription/plans` - 获取所有订阅计划
- `POST /api/subscription/plans` - 创建新计划（管理员）
- `GET /api/subscription/plans/:id` - 获取计划详情
- `PUT /api/subscription/plans/:id` - 更新计划（管理员）
- `DELETE /api/subscription/plans/:id` - 删除计划（管理员）

### 组织订阅

- `GET /api/subscription/organizations/:orgId` - 获取组织订阅
- `POST /api/subscription/subscribe` - 为组织创建订阅
- `POST /api/subscription/cancel` - 取消订阅
- `GET /api/subscription/status/:orgId` - 检查订阅状态

### Webhook

- `POST /api/subscription/webhook` - Stripe webhook 端点

---

## ⚙️ 环境变量

```bash
# 服务器
PORT=3002
NODE_ENV=development

# 数据库
DATABASE_URL=postgresql://user:password@localhost:5432/subscription_db

# Redis
REDIS_URL=redis://localhost:6379

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Auth Service
AUTH_SERVICE_URL=http://localhost:8080
JWKS_URI=http://localhost:8080/jwks.json

# 缓存
CACHE_TTL=300  # 5 分钟
```

---

## 🗄️ 数据库架构

### SubscriptionPlan 表

```prisma
model SubscriptionPlan {
  id              String   @id @default(uuid())
  name            String
  description     String?
  price           Decimal
  interval        String   // monthly, yearly
  stripePriceId   String   @unique
  features        Json
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

### Subscription 表

```prisma
model Subscription {
  id                    String   @id @default(uuid())
  organizationId        String   @unique
  planId                String
  stripeCustomerId      String
  stripeSubscriptionId  String   @unique
  status                String   // active, canceled, past_due
  currentPeriodStart    DateTime
  currentPeriodEnd      DateTime
  canceledAt            DateTime?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  plan                  SubscriptionPlan @relation(fields: [planId])
}
```

---

## 💳 Stripe 集成

### Webhook 事件

服务监听以下 Stripe webhook 事件：

- `customer.subscription.created` - 创建新订阅
- `customer.subscription.updated` - 订阅更新
- `customer.subscription.deleted` - 订阅取消
- `invoice.payment_succeeded` - 支付成功
- `invoice.payment_failed` - 支付失败

### 订阅流程

1. 用户选择订阅计划
2. 创建 Stripe Customer 和 Subscription
3. Stripe 发送 webhook 事件
4. 服务更新数据库和缓存
5. Auth Service 使用缓存的订阅状态

---

## 🔧 开发

### 脚本

```bash
# 开发模式（带热重载）
npm run dev

# 构建
npm run build

# 生产模式
npm start

# 运行测试
npm test

# Prisma 迁移
npx prisma migrate dev

# Prisma Studio（数据库 GUI）
npx prisma studio
```

### 测试 Webhook

使用 Stripe CLI 测试 webhook：

```bash
# 安装 Stripe CLI
brew install stripe/stripe-cli/stripe

# 登录
stripe login

# 转发 webhook 到本地
stripe listen --forward-to localhost:3002/api/subscription/webhook

# 触发测试事件
stripe trigger customer.subscription.created
```

---

## 📝 开发注意事项

### 订阅状态缓存

- 订阅状态缓存在 Redis 中，TTL 为 5 分钟
- Auth Service 在验证令牌时检查此缓存
- Webhook 事件会更新缓存

### 错误处理

- 所有 API 错误返回一致的 JSON 格式
- Stripe 错误会被正确记录和处理
- Webhook 失败会自动重试（由 Stripe 处理）

### 安全考虑

- Webhook 端点使用 Stripe 签名验证
- 所有管理端点需要管理员认证
- 敏感数据已加密存储

---

## 🔗 相关服务

- **Auth Service** - 身份认证和授权
- **Business Service** - 业务逻辑和 API
- **Frontend** - Web 界面

---

## 📄 许可证

专有 - © 2024 Tymoe Technologies
