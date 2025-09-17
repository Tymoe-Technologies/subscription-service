# Subscription Service

> **订阅管理与计费中心** - 基于Stripe的企业级订阅管理服务

## 🌐 服务概述

**服务职责**: 管理 Tymoe SaaS 平台的订阅计费、功能权限控制和用户自主订阅管理
**技术栈**: Node.js + TypeScript + Express + Prisma + Stripe API
**服务端口**: 8088

## 📖 目录

- [服务概述](#服务概述)
- [快速开始](#快速开始)
- [API接口详解](#api接口详解)
- [开发指南](#开发指南)
- [部署运维](#部署运维)

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

### 5. 前端调用示例

**用户登录后获取订阅状态：**
```javascript
const response = await fetch('/api/subscription-service/v1/organizations/org-123/subscription-status', {
  headers: {
    'Authorization': `Bearer ${userJwtToken}`,
    'Content-Type': 'application/json'
  }
});
```

**用户开始试用：**
```javascript
const response = await fetch('/api/subscription-service/v1/organizations/org-123/subscriptions/start-trial', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${userJwtToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    productKey: 'ploml'
  })
});
```

**用户订阅付费版：**
```javascript
const response = await fetch('/api/subscription-service/v1/organizations/org-123/subscriptions/checkout', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${userJwtToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    productKey: 'ploml',
    tier: 'basic',
    billingCycle: 'monthly',
    successUrl: 'https://yourapp.com/success',
    cancelUrl: 'https://yourapp.com/cancel'
  })
});

// 跳转到Stripe支付页面
window.location.href = response.data.checkoutUrl;
```

## 🎯 API接口概览

**基础URL**: `http://localhost:8088`

### 用户前端API (需要JWT认证)

#### 订阅状态查询
- **获取组织订阅状态**: `GET /api/subscription-service/v1/organizations/{organizationId}/subscription-status`
- **检查功能权限**: `GET /api/subscription-service/v1/organizations/{organizationId}/products/{productKey}/features/{featureKey}/access`
- **获取产品定价**: `GET /api/subscription-service/v1/products/{productKey}/pricing`

#### 用户自主订阅管理
- **开始试用**: `POST /api/subscription-service/v1/organizations/{organizationId}/subscriptions/start-trial`
- **订阅付费版**: `POST /api/subscription-service/v1/organizations/{organizationId}/subscriptions/checkout`
- **升级订阅**: `POST /api/subscription-service/v1/organizations/{organizationId}/subscriptions/upgrade`
- **取消订阅**: `POST /api/subscription-service/v1/organizations/{organizationId}/subscriptions/cancel`

### 管理员API (需要内部API密钥)

#### 组织管理
- **创建组织**: `POST /api/subscription-service/v1/admin/organizations`
- **获取组织信息**: `GET /api/subscription-service/v1/admin/organizations/{organizationId}`
- **更新组织信息**: `PATCH /api/subscription-service/v1/admin/organizations/{organizationId}`

#### 订阅管理
- **创建试用订阅**: `POST /api/subscription-service/v1/admin/subscriptions/trial`
- **创建付费订阅**: `POST /api/subscription-service/v1/admin/subscriptions/paid`
- **升级订阅**: `PATCH /api/subscription-service/v1/admin/subscriptions/{subscriptionId}/upgrade`
- **取消订阅**: `PATCH /api/subscription-service/v1/admin/subscriptions/{subscriptionId}/cancel`

#### Webhook
- **Stripe Webhook**: `POST /api/subscription-service/v1/webhooks/stripe`

#### 系统端点
- **健康检查**: `GET /health`

## 🏗️ 开发指南

### 服务架构

订阅服务采用分层架构设计，主要入口文件说明：

- **`src/index.ts`** - 主入口点，负责应用启动、错误处理和进程管理
- **`src/server.ts`** - 服务器启动模块，处理数据库/Redis连接和优雅关闭
- **`src/app.ts`** - Express应用配置，定义路由和中间件

### 🔐 认证架构

订阅服务支持两种认证方式：

1. **服务间调用** - 使用内部API密钥验证（`/admin` 路径）
2. **前端直接调用** - 使用用户JWT token验证（需要auth-service公钥）

### 📡 调用流程

```
前端(ploml/mopai) → subscription-service
      ↓
   JWT验证 + 组织权限验证 → 返回订阅状态
```

所有API路径都以 `/api/subscription-service/v1` 为基础路径。

### 🛠️ 开发环境设置

#### 1. **本地开发工具**
```bash
# 安装全局工具
npm install -g tsx prisma

# 安装Stripe CLI
brew install stripe/stripe-cli/stripe
```

#### 2. **数据库开发**
```bash
# 生成Prisma客户端
npm run prisma:gen

# 运行数据库迁移
npm run prisma:migrate

# 打开数据库管理界面
npm run prisma:studio
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
stripe listen --forward-to localhost:8088/api/subscription-service/v1/webhooks/stripe
```

### 🧪 测试策略

#### 代码质量检查
```bash
# 代码检查
npm run lint

# 类型检查
npm run build

# 代码格式化
npm run format
```

## 🚀 部署运维

### 环境变量

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `NODE_ENV` | 运行环境 | `production` |
| `PORT` | 服务端口 | `8088` |
| `DATABASE_URL` | 数据库连接 | `postgresql://...` |
| `REDIS_URL` | Redis连接 | `redis://localhost:6379/1` |
| `STRIPE_SECRET_KEY` | Stripe密钥 | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | Webhook密钥 | `whsec_...` |
| `AUTH_SERVICE_URL` | Auth服务地址 | `http://localhost:8087` |
| `INTERNAL_API_KEY` | 内部API密钥 | `secure-key` |

### Docker部署

```bash
# 构建镜像
docker build -t subscription-service .

# 运行容器
docker run -d \
  --name subscription-service \
  -p 8088:8088 \
  --env-file .env \
  subscription-service
```

### 健康检查

```bash
# 检查服务状态
curl http://localhost:8088/health

# 预期响应
{
  "status": "ok",
  "service": "subscription-service",
  "version": "1.0.0",
  "timestamp": "2024-01-20T10:30:00Z"
}
```

### 监控指标

- **响应时间**: 95%请求 < 200ms
- **可用性**: 99.9%
- **错误率**: < 0.1%
- **Stripe延迟**: webhook < 5秒处理

---

详细的前端集成指南请参考: [README_for_frontend.md](./README_for_frontend.md)