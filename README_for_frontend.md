# Subscription Service - 前端开发指南

## 📋 概述

本文档详细说明前端如何与 subscription-service 集成，实现高效的订阅权限控制和缓存机制。

## 🔐 认证架构

### JWT认证流程
1. 用户在auth-service登录获得JWT token
2. 前端调用subscription-service时在请求头携带JWT
3. subscription-service验证JWT并检查用户对组织的权限
4. 返回该用户有权限访问的订阅信息

### 请求头格式
```javascript
headers: {
  'Authorization': `Bearer ${userJwtToken}`,
  'Content-Type': 'application/json'
}
```

## 🎯 核心设计理念

### 缓存优先策略
- **登录后立即缓存**：获取用户订阅信息并存储到localStorage
- **智能判断**：只在必要时才调用subscription-service
- **降级处理**：服务不可用时的优雅处理

### 减少网络请求
- **正常操作**：直接使用缓存，无网络请求
- **权限不足**：才触发subscription-service查询
- **缓存过期**：定期刷新订阅状态

## 🔧 前端API接口

### 基础URL
```
http://localhost:8088/api/subscription-service/v1
```

### 1. 获取组织订阅状态
```http
GET /organizations/{organizationId}/subscription-status
```

**用途**：用户选择店铺后立即调用，获取完整订阅状态并缓存

**返回格式**：
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
          "service_catalog"
        ]
      }
    ],
    "lastUpdated": "2024-01-20T10:30:00Z"
  }
}
```

### 2. 检查功能权限
```http
GET /organizations/{organizationId}/products/{productKey}/features/{featureKey}/access
```

**用途**：当缓存显示无权限时，实时检查最新权限状态

**返回格式**：
```json
{
  "success": true,
  "data": {
    "hasAccess": false,
    "currentTier": "trial",
    "featureKey": "advanced_reports"
  }
}
```

### 3. 获取产品定价
```http
GET /products/{productKey}/pricing
```

**用途**：显示升级页面时获取定价信息

**返回格式**：
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
        "currency": "usd"
      }
    ]
  }
}
```

## 💻 前端集成示例

### 1. 创建Subscription Service客户端

```typescript
class SubscriptionService {
  private baseURL = 'http://localhost:8088/api/subscription-service/v1';
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async request(endpoint: string, options?: RequestInit) {
    const response = await fetch(`${this.baseURL}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API请求失败: ${response.status}`);
    }

    return response.json();
  }

  async getOrganizationSubscriptionStatus(organizationId: string) {
    return this.request(`/organizations/${organizationId}/subscription-status`);
  }

  async checkFeatureAccess(organizationId: string, productKey: string, featureKey: string) {
    return this.request(`/organizations/${organizationId}/products/${productKey}/features/${featureKey}/access`);
  }

  async getProductPricing(productKey: string) {
    return this.request(`/products/${productKey}/pricing`);
  }
}
```

### 2. 订阅状态管理器

```typescript
class SubscriptionManager {
  private subscriptionService: SubscriptionService;
  private cache: Map<string, any> = new Map();
  private cacheExpiry: Map<string, number> = new Map();

  constructor(token: string) {
    this.subscriptionService = new SubscriptionService(token);
  }

  // 用户选择店铺后立即调用
  async loadOrganizationSubscription(organizationId: string) {
    try {
      const data = await this.subscriptionService.getOrganizationSubscriptionStatus(organizationId);

      // 缓存到localStorage和内存
      const cacheKey = `subscription_${organizationId}`;
      localStorage.setItem(cacheKey, JSON.stringify(data));
      this.cache.set(cacheKey, data);
      this.cacheExpiry.set(cacheKey, Date.now() + 15 * 60 * 1000); // 15分钟过期

      return data;
    } catch (error) {
      console.error('加载订阅状态失败:', error);
      // 尝试使用localStorage缓存
      const cached = localStorage.getItem(`subscription_${organizationId}`);
      return cached ? JSON.parse(cached) : null;
    }
  }

  // 检查功能权限
  async hasFeatureAccess(organizationId: string, productKey: string, featureKey: string): Promise<boolean> {
    // 1. 先检查缓存
    const cached = this.getCachedSubscription(organizationId);
    if (cached) {
      const subscription = cached.data.subscriptions.find(s => s.productKey === productKey);
      if (subscription && subscription.features.includes(featureKey)) {
        return true;
      }
    }

    // 2. 缓存显示无权限，实时检查
    try {
      const result = await this.subscriptionService.checkFeatureAccess(organizationId, productKey, featureKey);
      return result.data.hasAccess;
    } catch (error) {
      console.error('权限检查失败:', error);
      return false;
    }
  }

  private getCachedSubscription(organizationId: string) {
    const cacheKey = `subscription_${organizationId}`;
    const expiry = this.cacheExpiry.get(cacheKey);

    if (expiry && Date.now() > expiry) {
      // 缓存过期，异步刷新
      this.loadOrganizationSubscription(organizationId);
      return null;
    }

    return this.cache.get(cacheKey);
  }
}
```

### 3. 使用示例

```typescript
// 应用初始化
const subscriptionManager = new SubscriptionManager(localStorage.getItem('jwt_token'));

// 用户选择店铺后
async function onShopSelected(organizationId: string) {
  showLoading('加载订阅信息...');

  try {
    await subscriptionManager.loadOrganizationSubscription(organizationId);
    hideLoading();
  } catch (error) {
    showError('无法加载订阅信息，某些功能可能无法使用');
  }
}

// 功能权限检查
async function openAdvancedReports() {
  const hasAccess = await subscriptionManager.hasFeatureAccess(
    currentOrganizationId,
    'ploml',
    'advanced_reports'
  );

  if (hasAccess) {
    // 打开高级报告
    navigate('/reports/advanced');
  } else {
    // 显示升级提示
    showUpgradeDialog('advanced_reports');
  }
}
```

## 🚨 错误处理

### 常见错误码
- `401` - JWT token无效或过期
- `403` - 用户无权访问该组织
- `404` - 组织或订阅不存在
- `500` - 服务器错误

### 错误处理策略
```typescript
function handleApiError(error: any) {
  if (error.status === 401) {
    // Token过期，重新登录
    redirectToLogin();
  } else if (error.status === 403) {
    // 权限不足
    showError('您没有权限访问该店铺');
  } else if (error.status === 500) {
    // 服务错误，使用缓存数据
    showWarning('服务暂时不可用，使用缓存数据');
  }
}
```

## 📊 性能优化建议

### 1. 缓存策略
- 订阅状态缓存15分钟
- 功能权限结果缓存5分钟
- 使用localStorage持久化

### 2. 请求优化
- 批量检查多个功能权限
- 使用防抖避免频繁请求
- 预加载关键功能的权限状态

### 3. 用户体验
- 显示加载状态
- 优雅降级处理
- 离线模式支持

## 🔍 调试工具

### 开发环境配置
```typescript
// 开发模式下启用详细日志
if (process.env.NODE_ENV === 'development') {
  window.subscriptionDebug = {
    clearCache: () => localStorage.clear(),
    viewCache: () => console.table(localStorage),
    testPermission: (orgId, product, feature) =>
      subscriptionManager.hasFeatureAccess(orgId, product, feature)
  };
}
```