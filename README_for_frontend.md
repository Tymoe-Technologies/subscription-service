# 前端集成指南 - Subscription Service

## 📋 概述

本文档详细说明前端如何与 subscription-service 集成，实现高效的订阅权限控制和缓存机制。

## 🎯 核心设计理念

### 缓存优先策略
- **登录后立即缓存**：获取用户订阅信息并存储到本地
- **智能判断**：只在必要时才调用 subscription-service
- **降级处理**：服务不可用时的优雅处理

### 减少网络请求
- **正常操作**：直接使用缓存，无网络请求
- **权限不足**：才触发 subscription-service 查询
- **缓存过期**：定期刷新订阅状态

## 🔧 必需的 API 调整

### 新增 API 接口

需要在 subscription-service 中新增以下接口：

```http
GET /api/organizations/{organizationId}/cache-info
```

**用途**：专门为前端缓存设计的轻量级订阅信息接口

**返回格式**：
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
        "features": [
          "appointment_booking",
          "customer_management", 
          "service_catalog"
        ]
      },
      "mopai": {
        "tier": "trial",
        "status": "trialing",
        "expiresAt": "2024-01-20T23:59:59Z",
        "isActive": true,
        "features": [
          "table_management",
          "menu_management",
          "order_taking"
        ]
      }
    },
    "cacheValidUntil": "2024-01-15T10:30:00Z", // 建议的缓存过期时间
    "lastUpdated": "2024-01-15T10:00:00Z"
  }
}
```

## 🚀 前端实现指南

### 1. 登录后初始化缓存

```javascript
// 用户登录成功后立即执行
async function initializeSubscriptionCache(organizationId) {
  try {
    const response = await fetch(
      `/api/subscription-service/organizations/${organizationId}/cache-info`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'X-API-Key': process.env.INTERNAL_API_KEY
        }
      }
    );
    
    const result = await response.json();
    
    if (result.success) {
      // 存储到localStorage
      const cacheData = {
        ...result.data,
        cachedAt: Date.now(),
        // 客户端缓存时间：10分钟
        cacheValidUntil: Date.now() + (10 * 60 * 1000)
      };
      
      localStorage.setItem('subscription-cache', JSON.stringify(cacheData));
      console.log('订阅信息缓存成功');
      
      return cacheData;
    }
  } catch (error) {
    console.error('获取订阅信息失败:', error);
    // 使用上次的缓存（如果有）
    return getExistingCache();
  }
}
```

### 2. 功能权限检查函数

```javascript
// 核心权限检查函数
function checkFeatureAccess(productKey, featureKey) {
  const cache = getSubscriptionCache();
  
  if (!cache) {
    return { hasAccess: false, reason: 'no_cache' };
  }
  
  const subscription = cache.subscriptions[productKey];
  
  if (!subscription) {
    return { hasAccess: false, reason: 'no_subscription' };
  }
  
  if (!subscription.isActive) {
    return { hasAccess: false, reason: 'subscription_inactive' };
  }
  
  // 检查是否过期
  if (new Date(subscription.expiresAt) < new Date()) {
    return { hasAccess: false, reason: 'subscription_expired' };
  }
  
  // 检查功能权限
  const hasFeature = subscription.features.includes(featureKey);
  
  return {
    hasAccess: hasFeature,
    reason: hasFeature ? 'granted' : 'feature_not_available',
    currentTier: subscription.tier,
    requiredTier: getRequiredTier(productKey, featureKey)
  };
}

// 获取缓存
function getSubscriptionCache() {
  try {
    const cached = localStorage.getItem('subscription-cache');
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    console.error('读取订阅缓存失败:', error);
    return null;
  }
}

// 判断缓存是否有效
function isCacheValid(cache) {
  if (!cache) return false;
  
  const now = Date.now();
  
  // 检查客户端缓存时间
  if (now > cache.cacheValidUntil) {
    return false;
  }
  
  // 检查服务端建议的缓存时间
  if (cache.cacheValidUntil && now > new Date(cache.cacheValidUntil).getTime()) {
    return false;
  }
  
  return true;
}
```

### 3. API 调用拦截器

```javascript
// 业务API调用前的权限检查
async function callBusinessAPI(endpoint, options = {}) {
  const { requiredFeature, productKey = 'ploml' } = options;
  
  // 如果需要特定功能权限
  if (requiredFeature) {
    const accessCheck = await ensureFeatureAccess(productKey, requiredFeature);
    
    if (!accessCheck.hasAccess) {
      // 显示权限不足提示
      showAccessDeniedDialog(accessCheck);
      throw new Error(`权限不足: ${accessCheck.reason}`);
    }
  }
  
  // 执行实际的API调用
  return fetch(endpoint, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      ...options.headers
    }
  });
}

// 确保有功能访问权限
async function ensureFeatureAccess(productKey, featureKey) {
  let cache = getSubscriptionCache();
  
  // 检查缓存是否有效
  if (!isCacheValid(cache)) {
    // 缓存无效，重新获取
    cache = await refreshSubscriptionCache();
  }
  
  const accessCheck = checkFeatureAccess(productKey, featureKey);
  
  // 如果权限不足，再次确认（可能是订阅状态变更）
  if (!accessCheck.hasAccess && accessCheck.reason !== 'feature_not_available') {
    console.log('权限不足，重新验证订阅状态...');
    cache = await refreshSubscriptionCache();
    return checkFeatureAccess(productKey, featureKey);
  }
  
  return accessCheck;
}

// 刷新订阅缓存
async function refreshSubscriptionCache() {
  const user = getCurrentUser(); // 获取当前用户信息
  if (!user?.organizationId) {
    throw new Error('用户信息不完整');
  }
  
  return await initializeSubscriptionCache(user.organizationId);
}
```

### 4. UI 组件集成

```javascript
// React Hook 示例
import { useState, useEffect } from 'react';

function useFeatureAccess(productKey, featureKey) {
  const [hasAccess, setHasAccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [accessInfo, setAccessInfo] = useState(null);
  
  useEffect(() => {
    async function checkAccess() {
      try {
        const result = await ensureFeatureAccess(productKey, featureKey);
        setHasAccess(result.hasAccess);
        setAccessInfo(result);
      } catch (error) {
        console.error('权限检查失败:', error);
        setHasAccess(false);
      } finally {
        setLoading(false);
      }
    }
    
    checkAccess();
  }, [productKey, featureKey]);
  
  return { hasAccess, loading, accessInfo };
}

// 使用示例
function EmployeeManagementButton() {
  const { hasAccess, loading, accessInfo } = useFeatureAccess('ploml', 'staff_scheduling');
  
  if (loading) {
    return <button disabled>检查权限中...</button>;
  }
  
  if (!hasAccess) {
    return (
      <button 
        onClick={() => showUpgradeDialog(accessInfo)}
        className="upgrade-required"
      >
        员工排班 (需要升级)
      </button>
    );
  }
  
  return (
    <button onClick={() => navigateToEmployeeManagement()}>
      员工排班
    </button>
  );
}
```

### 5. 错误处理和降级策略

```javascript
// 降级策略配置
const FEATURE_CRITICALITY = {
  // 核心功能 - 即使服务不可用也要允许
  CRITICAL: [
    'appointment_booking',
    'customer_management',
    'table_management',
    'order_taking'
  ],
  
  // 标准功能 - 有缓存就允许
  STANDARD: [
    'service_catalog',
    'menu_management',
    'staff_scheduling'
  ],
  
  // 高级功能 - 必须实时验证
  PREMIUM: [
    'analytics_reports',
    'inventory_management',
    'api_access',
    'multi_location'
  ]
};

// 降级处理函数
function handleSubscriptionServiceFailure(featureKey, lastKnownAccess) {
  if (FEATURE_CRITICALITY.CRITICAL.includes(featureKey)) {
    console.warn(`允许核心功能 ${featureKey} 访问（服务降级）`);
    return { hasAccess: true, reason: 'degraded_service' };
  }
  
  if (FEATURE_CRITICALITY.STANDARD.includes(featureKey) && lastKnownAccess) {
    const cacheAge = Date.now() - lastKnownAccess.timestamp;
    if (cacheAge < 30 * 60 * 1000) { // 30分钟内的缓存
      console.warn(`使用缓存允许标准功能 ${featureKey} 访问`);
      return { hasAccess: true, reason: 'cached_access' };
    }
  }
  
  // 高级功能拒绝访问
  return {
    hasAccess: false,
    reason: 'service_unavailable',
    message: '订阅验证服务暂时不可用，请稍后重试'
  };
}

// 全局错误处理
async function safeFeatureCheck(productKey, featureKey) {
  try {
    return await ensureFeatureAccess(productKey, featureKey);
  } catch (error) {
    console.error('订阅服务调用失败:', error);
    
    // 获取最后已知的访问状态
    const lastKnownCache = getSubscriptionCache();
    const lastKnownAccess = lastKnownCache?.subscriptions?.[productKey];
    
    return handleSubscriptionServiceFailure(featureKey, lastKnownAccess);
  }
}
```

### 6. 缓存管理工具

```javascript
// 缓存管理工具类
class SubscriptionCacheManager {
  static CACHE_KEY = 'subscription-cache';
  static DEFAULT_CACHE_TTL = 10 * 60 * 1000; // 10分钟
  
  // 设置缓存
  static setCache(data) {
    const cacheData = {
      ...data,
      cachedAt: Date.now(),
      cacheValidUntil: Date.now() + this.DEFAULT_CACHE_TTL
    };
    
    localStorage.setItem(this.CACHE_KEY, JSON.stringify(cacheData));
    
    // 触发缓存更新事件
    window.dispatchEvent(new CustomEvent('subscriptionCacheUpdated', {
      detail: cacheData
    }));
  }
  
  // 获取缓存
  static getCache() {
    try {
      const cached = localStorage.getItem(this.CACHE_KEY);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.error('读取订阅缓存失败:', error);
      return null;
    }
  }
  
  // 清除缓存
  static clearCache() {
    localStorage.removeItem(this.CACHE_KEY);
    window.dispatchEvent(new CustomEvent('subscriptionCacheCleared'));
  }
  
  // 检查缓存是否过期
  static isCacheExpired() {
    const cache = this.getCache();
    if (!cache) return true;
    
    return Date.now() > cache.cacheValidUntil;
  }
  
  // 获取缓存剩余时间
  static getCacheRemainingTime() {
    const cache = this.getCache();
    if (!cache) return 0;
    
    return Math.max(0, cache.cacheValidUntil - Date.now());
  }
}
```

## 🎯 实际使用场景

### 场景1：用户点击功能按钮

```javascript
// 用户点击"数据分析"按钮
async function onAnalyticsClick() {
  const loadingToast = showLoading('检查权限中...');
  
  try {
    const access = await safeFeatureCheck('ploml', 'analytics_reports');
    
    if (access.hasAccess) {
      hideLoading(loadingToast);
      navigateToAnalytics();
    } else {
      hideLoading(loadingToast);
      showUpgradeDialog({
        currentTier: access.currentTier,
        requiredTier: access.requiredTier,
        feature: '数据分析',
        reason: access.reason
      });
    }
  } catch (error) {
    hideLoading(loadingToast);
    showErrorDialog('权限验证失败，请稍后重试');
  }
}
```

### 场景2：页面加载时的权限检查

```javascript
// 页面组件加载时检查权限
function AnalyticsPage() {
  const [hasAccess, setHasAccess] = useState(null);
  
  useEffect(() => {
    async function checkPageAccess() {
      const access = await safeFeatureCheck('ploml', 'analytics_reports');
      setHasAccess(access.hasAccess);
      
      if (!access.hasAccess) {
        // 3秒后自动跳转到升级页面
        setTimeout(() => {
          showUpgradeDialog(access);
        }, 3000);
      }
    }
    
    checkPageAccess();
  }, []);
  
  if (hasAccess === null) {
    return <LoadingSpinner message="验证权限中..." />;
  }
  
  if (!hasAccess) {
    return (
      <AccessDeniedPage 
        feature="数据分析"
        onUpgrade={() => showUpgradeDialog()}
      />
    );
  }
  
  return <AnalyticsContent />;
}
```

### 场景3：菜单项的动态显示

```javascript
// 导航菜单组件
function NavigationMenu() {
  const [menuItems, setMenuItems] = useState([]);
  
  useEffect(() => {
    async function buildMenu() {
      const cache = getSubscriptionCache();
      const features = cache?.subscriptions?.ploml?.features || [];
      
      const items = [
        {
          key: 'customers',
          label: '客户管理',
          feature: 'customer_management',
          icon: 'users',
          path: '/customers'
        },
        {
          key: 'appointments',
          label: '预约管理', 
          feature: 'appointment_booking',
          icon: 'calendar',
          path: '/appointments'
        },
        {
          key: 'staff',
          label: '员工排班',
          feature: 'staff_scheduling',
          icon: 'team',
          path: '/staff'
        },
        {
          key: 'analytics',
          label: '数据分析',
          feature: 'analytics_reports',
          icon: 'chart',
          path: '/analytics'
        }
      ];
      
      // 根据权限过滤菜单项
      const accessibleItems = items.filter(item => 
        features.includes(item.feature)
      );
      
      // 添加需要升级的菜单项（灰色显示）
      const unavailableItems = items
        .filter(item => !features.includes(item.feature))
        .map(item => ({
          ...item,
          disabled: true,
          label: `${item.label} (需要升级)`,
          onClick: () => showUpgradeDialog({ feature: item.feature })
        }));
      
      setMenuItems([...accessibleItems, ...unavailableItems]);
    }
    
    buildMenu();
    
    // 监听缓存更新
    const handleCacheUpdate = () => buildMenu();
    window.addEventListener('subscriptionCacheUpdated', handleCacheUpdate);
    
    return () => {
      window.removeEventListener('subscriptionCacheUpdated', handleCacheUpdate);
    };
  }, []);
  
  return (
    <nav>
      {menuItems.map(item => (
        <MenuItem key={item.key} {...item} />
      ))}
    </nav>
  );
}
```

## 🔄 缓存刷新策略

### 自动刷新时机

```javascript
// 自动刷新缓存的时机
const CACHE_REFRESH_TRIGGERS = {
  // 定时刷新：每5分钟检查一次
  PERIODIC: 5 * 60 * 1000,
  
  // 权限检查失败时
  ACCESS_DENIED: true,
  
  // 用户主动操作
  USER_UPGRADE: true,
  
  // 页面重新激活
  PAGE_FOCUS: true
};

// 设置定时刷新
function setupPeriodicCacheRefresh() {
  setInterval(async () => {
    const cache = getSubscriptionCache();
    
    if (cache && isCacheExpired()) {
      console.log('定时刷新订阅缓存');
      await refreshSubscriptionCache();
    }
  }, CACHE_REFRESH_TRIGGERS.PERIODIC);
}

// 页面焦点事件刷新
window.addEventListener('focus', async () => {
  const cache = getSubscriptionCache();
  
  if (!cache || isCacheExpired()) {
    console.log('页面重新激活，刷新订阅缓存');
    await refreshSubscriptionCache();
  }
});

// 用户升级后手动刷新
function onSubscriptionUpgraded() {
  // 立即清除旧缓存
  SubscriptionCacheManager.clearCache();
  
  // 重新获取订阅信息
  setTimeout(async () => {
    await refreshSubscriptionCache();
    showSuccessMessage('订阅已升级，新功能已启用！');
  }, 2000); // 给Stripe webhook一些处理时间
}
```

## 📱 移动端适配

### 离线支持

```javascript
// 离线状态处理
function isOnline() {
  return navigator.onLine;
}

// 离线时的权限检查
async function offlineFeatureCheck(productKey, featureKey) {
  const cache = getSubscriptionCache();
  
  if (!cache) {
    return {
      hasAccess: false,
      reason: 'offline_no_cache',
      message: '网络不可用且无缓存数据'
    };
  }
  
  // 使用缓存数据，但标记为离线模式
  const result = checkFeatureAccess(productKey, featureKey);
  
  if (result.hasAccess) {
    result.offline = true;
    result.message = '离线模式：使用缓存数据';
  }
  
  return result;
}

// 网络状态监听
window.addEventListener('online', () => {
  console.log('网络已恢复，刷新订阅状态');
  refreshSubscriptionCache();
});

window.addEventListener('offline', () => {
  console.log('网络已断开，启用离线模式');
  showOfflineNotice();
});
```

## 🎨 UI/UX 最佳实践

### 升级提示对话框

```javascript
// 统一的升级提示组件
function showUpgradeDialog(accessInfo) {
  const { currentTier, requiredTier, feature, reason } = accessInfo;
  
  const dialogContent = {
    title: '功能升级',
    message: getUpgradeMessage(reason, feature, currentTier, requiredTier),
    actions: [
      {
        label: '立即升级',
        primary: true,
        onClick: () => navigateToUpgrade(requiredTier)
      },
      {
        label: '稍后再说',
        onClick: () => closeDialog()
      }
    ]
  };
  
  showModal(dialogContent);
}

function getUpgradeMessage(reason, feature, currentTier, requiredTier) {
  const messages = {
    'feature_not_available': `${feature} 功能需要 ${requiredTier} 套餐，您当前是 ${currentTier} 套餐`,
    'subscription_expired': `您的订阅已过期，请续费以继续使用 ${feature} 功能`,
    'subscription_inactive': '您的订阅当前不活跃，请联系客服或重新订阅',
    'no_subscription': `使用 ${feature} 功能需要订阅套餐，立即开始免费试用？`
  };
  
  return messages[reason] || `无法使用 ${feature} 功能，请升级您的订阅`;
}
```

### 加载状态优化

```javascript
// 智能加载状态
function SmartLoadingSpinner({ feature, productKey }) {
  const [message, setMessage] = useState('检查权限中...');
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setMessage('连接订阅服务中...');
    }, 2000);
    
    const timer2 = setTimeout(() => {
      setMessage('服务响应较慢，请稍候...');
    }, 5000);
    
    return () => {
      clearTimeout(timer);
      clearTimeout(timer2);
    };
  }, []);
  
  return (
    <div className="loading-container">
      <Spinner />
      <p>{message}</p>
      <button 
        onClick={() => handleSubscriptionServiceFailure(feature, null)}
        className="fallback-button"
      >
        跳过检查，直接访问
      </button>
    </div>
  );
}
```

## 🛠️ 调试和监控

### 开发者工具

```javascript
// 开发模式下的调试工具
if (process.env.NODE_ENV === 'development') {
  // 全局调试对象
  window.SubscriptionDebug = {
    getCache: () => getSubscriptionCache(),
    clearCache: () => SubscriptionCacheManager.clearCache(),
    refreshCache: () => refreshSubscriptionCache(),
    checkFeature: (product, feature) => checkFeatureAccess(product, feature),
    
    // 模拟不同的订阅状态
    mockSubscription: (productKey, tier) => {
      const cache = getSubscriptionCache();
      if (cache) {
        cache.subscriptions[productKey].tier = tier;
        cache.subscriptions[productKey].features = getTierFeatures(productKey, tier);
        SubscriptionCacheManager.setCache(cache);
      }
    }
  };
  
  console.log('订阅调试工具已启用:', window.SubscriptionDebug);
}
```

### 性能监控

```javascript
// 性能监控
class SubscriptionPerformanceMonitor {
  static metrics = {
    cacheHits: 0,
    cacheMisses: 0,
    apiCalls: 0,
    averageResponseTime: 0
  };
  
  static recordCacheHit() {
    this.metrics.cacheHits++;
    this.logMetrics();
  }
  
  static recordCacheMiss() {
    this.metrics.cacheMisses++;
  }
  
  static recordApiCall(responseTime) {
    this.metrics.apiCalls++;
    this.metrics.averageResponseTime = 
      (this.metrics.averageResponseTime + responseTime) / 2;
    this.logMetrics();
  }
  
  static logMetrics() {
    const hitRate = this.metrics.cacheHits / 
      (this.metrics.cacheHits + this.metrics.cacheMisses) * 100;
    
    console.log(`订阅缓存命中率: ${hitRate.toFixed(1)}%`);
  }
  
  static getReport() {
    return this.metrics;
  }
}
```

## 📋 检查清单

### 集成前检查

- [ ] subscription-service API 已部署并可访问
- [ ] 内部 API 密钥已配置
- [ ] 功能权限配置已确认
- [ ] 缓存存储策略已确定（localStorage vs sessionStorage）

### 功能测试

- [ ] 登录后缓存正常初始化
- [ ] 功能权限检查准确
- [ ] 缓存过期自动刷新
- [ ] 网络异常降级处理正常
- [ ] 升级后缓存及时更新

### 性能测试

- [ ] 缓存命中率 > 90%
- [ ] API 调用次数大幅减少
- [ ] 页面响应速度提升
- [ ] 离线模式正常工作

## 🔧 故障排除

### 常见问题

**Q: 缓存显示有权限，但 API 调用失败**
A: 检查缓存是否过期，或者订阅状态已变更。调用 `refreshSubscriptionCache()` 更新。

**Q: subscription-service 调用超时**
A: 检查网络连接和服务状态。确保降级策略正确处理超时情况。

**Q: 权限检查结果不一致**
A: 清除缓存重新获取：`SubscriptionCacheManager.clearCache()`

**Q: 用户升级后新功能不可用**
A: Stripe webhook 可能有延迟，等待2-3分钟或手动刷新缓存。

### 调试命令

```javascript
// 在浏览器控制台执行
SubscriptionDebug.getCache();           // 查看当前缓存
SubscriptionDebug.refreshCache();       // 强制刷新缓存
SubscriptionDebug.checkFeature('ploml', 'analytics_reports'); // 测试权限
SubscriptionDebug.mockSubscription('ploml', 'pro'); // 模拟套餐
```

## 🎯 总结

通过实施这套前端缓存方案，你将获得：

- **🚀 性能提升**：减少 90%+ 的网络请求
- **💪 用户体验**：流畅的功能访问体验  
- **🛡️ 容错能力**：服务异常时的优雅降级
- **📱 离线支持**：网络不稳定时的基础功能保障
- **🔧 易维护性**：清晰的权限控制逻辑

记住：**缓存优先，智能验证，优雅降级**是这套方案的核心原则。