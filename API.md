# Subscription Service API 文档

## 概述

订阅服务API提供完整的SaaS订阅管理功能,包括产品目录管理、订阅生命周期管理、计费结算等。

**基础路径**: `/api/subscription-service/v1`

**版本**: v1.0.0

---

## API分类

### 1️⃣ 管理员API (Admin APIs)
- **调用者**: 管理员后台
- **鉴权方式**: API Key (`X-Admin-API-Key`)
- **用途**: 管理产品目录、定价、配置

### 2️⃣ 订阅管理API (Subscription APIs)
- **调用者**: 前端用户
- **鉴权方式**: JWT Token (`Authorization: Bearer <token>`)
- **用途**: 用户自助管理订阅

### 3️⃣ 查询API (Query APIs)
- **调用者**: 前端用户 + 其他微服务
- **鉴权方式**: JWT Token
- **用途**: 查询订阅状态、账单、使用量

### 4️⃣ 内部API (Internal APIs)
- **调用者**: auth-service、notification-service等微服务
- **鉴权方式**: Service API Key
- **用途**: 跨服务的权限检查和数据同步

### 5️⃣ Webhook API
- **调用者**: Stripe/PayPal等支付商
- **鉴权方式**: Webhook签名验证
- **用途**: 接收支付结果回调

---

## 通用响应格式

### 成功响应
```json
{
  "success": true,
  "data": {},
  "message": "操作成功描述"
}
```

### 失败响应
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "用户可读的错误信息",
    "details": {}
  }
}
```

---

## Part 1: 管理员API - 产品目录管理

### Phase 1: 模块管理 (Modules Management)

#### 🔐 鉴权配置

**环境变量**:
```bash
# 支持多个Admin API Key，用逗号分隔
ADMIN_API_KEYS=admin_ryan_sk_Z678YTHUJ,admin_meng_sk_O0S8HBLAY
```

**请求头**:
```
X-Admin-API-Key: <其中一个有效的ADMIN_API_KEY>
```

**鉴权流程**:
1. 从请求头获取 `X-Admin-API-Key`
2. 从环境变量 `ADMIN_API_KEYS` 解析API Key列表（逗号分隔）
3. 检查提供的Key是否在有效列表中
4. 验证成功 → 放行
5. 验证失败或缺失 → 返回 401/403

---

#### 1. 创建模块

**端点**: `POST /api/subscription-service/v1/admin/modules`

**描述**: 创建新的功能模块

**请求头**:
```
X-Admin-API-Key: <ADMIN_API_KEY>
Content-Type: application/json
```

**请求体**:
```typescript
{
  "key": string,              // 必需,模块标识,唯一,3-50字符,小写字母+下划线
  "name": string,             // 必需,模块名称,1-100字符
  "description": string,      // 可选,功能描述,最大1000字符
  "category": string,         // 必需,枚举:"core"|"business"|"marketing"|"analytics"
  "monthlyPrice": number,     // 必需,月费价格,>=0,最多2位小数
  "pricingModel": string,     // 必需,枚举:"fixed"|"per_usage"|"hybrid"
  "dependencies": string[],   // 可选,依赖的其他模块keys,默认[]
  "status": string            // 可选,枚举:"ACTIVE"|"COMING_SOON",默认"ACTIVE"
}
```

**请求示例**:
```json
{
  "key": "appointment",
  "name": "预约管理",
  "description": "完整的预约管理功能,包括在线预约、日历视图、提醒通知",
  "category": "business",
  "monthlyPrice": 29.99,
  "pricingModel": "fixed",
  "dependencies": ["notification"],
  "status": "ACTIVE"
}
```

**执行逻辑**:
```
1. 鉴权检查
   ├─ 验证 X-Admin-API-Key header 存在
   ├─ 从 process.env.ADMIN_API_KEY 获取配置的 API Key
   ├─ 严格比对请求的 API Key === 配置的 API Key
   └─ 失败则返回 401/403

2. 参数校验
   ├─ key: 格式正则 /^[a-z][a-z0-9_]*$/,长度3-50
   ├─ name: 非空,长度1-100
   ├─ category: 必须在枚举值中
   ├─ monthlyPrice: >=0, 最多2位小数
   ├─ pricingModel: 必须在枚举值中
   ├─ dependencies: 数组类型,每个元素为字符串
   └─ status: 必须在枚举值中(如果提供)

3. 业务校验
   ├─ 检查 key 是否已存在(查询 modules 表,key 唯一索引)
   └─ 检查 dependencies 中的模块是否都存在(批量查询 modules 表)

4. 数据库操作
   ├─ 插入 modules 表
   └─ 返回创建的记录(包括生成的id和时间戳)

5. 成功返回
```

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "key": "appointment",
    "name": "预约管理",
    "description": "完整的预约管理功能,包括在线预约、日历视图、提醒通知",
    "category": "business",
    "monthlyPrice": 29.99,
    "pricingModel": "fixed",
    "dependencies": ["notification"],
    "status": "ACTIVE",
    "createdAt": "2025-10-14T10:30:00.000Z",
    "updatedAt": "2025-10-14T10:30:00.000Z"
  },
  "message": "模块创建成功"
}
```

**错误响应**:

| HTTP状态码 | 错误代码 | 说明 | 响应示例 |
|-----------|---------|------|---------|
| 401 | `MISSING_API_KEY` | 缺少Admin API Key | `{"success": false, "error": {"code": "MISSING_API_KEY", "message": "缺少管理员API密钥"}}` |
| 403 | `INVALID_API_KEY` | 无效的Admin API Key | `{"success": false, "error": {"code": "INVALID_API_KEY", "message": "无效的管理员API密钥"}}` |
| 400 | `VALIDATION_ERROR` | 请求参数验证失败 | `{"success": false, "error": {"code": "VALIDATION_ERROR", "message": "请求参数验证失败", "details": {"key": "模块标识只能包含小写字母、数字和下划线"}}}` |
| 409 | `MODULE_KEY_EXISTS` | 模块标识已存在 | `{"success": false, "error": {"code": "MODULE_KEY_EXISTS", "message": "模块标识'appointment'已存在"}}` |
| 400 | `INVALID_DEPENDENCIES` | 依赖模块不存在 | `{"success": false, "error": {"code": "INVALID_DEPENDENCIES", "message": "依赖的模块不存在", "details": {"missing": ["notification"]}}}` |
| 500 | `INTERNAL_SERVER_ERROR` | 服务器内部错误 | `{"success": false, "error": {"code": "INTERNAL_SERVER_ERROR", "message": "创建模块时发生错误,请稍后重试"}}` |

---

#### 2. 列出所有模块

**端点**: `GET /api/subscription-service/v1/admin/modules`

**描述**: 分页查询模块列表,支持筛选和排序

**请求头**:
```
X-Admin-API-Key: <ADMIN_API_KEY>
```

**查询参数**:
```typescript
{
  "page": number,         // 可选,页码,从1开始,默认1
  "limit": number,        // 可选,每页数量,1-100,默认20
  "category": string,     // 可选,筛选分类:"core"|"business"|"marketing"|"analytics"
  "status": string,       // 可选,筛选状态:"ACTIVE"|"DEPRECATED"|"SUSPENDED"|"COMING_SOON"
  "sortBy": string,       // 可选,排序字段:"createdAt"|"monthlyPrice"|"name",默认"createdAt"
  "order": string         // 可选,排序方向:"asc"|"desc",默认"desc"
}
```

**请求示例**:
```
GET /api/subscription-service/v1/admin/modules?page=1&limit=20&category=business&status=ACTIVE&sortBy=monthlyPrice&order=asc
```

**执行逻辑**:
```
1. 鉴权检查
   └─ 验证 X-Admin-API-Key

2. 参数校验
   ├─ page: >=1的整数
   ├─ limit: 1-100的整数
   ├─ category: 必须在枚举值中(如果提供)
   ├─ status: 必须在枚举值中(如果提供)
   ├─ sortBy: 必须在允许的字段中
   └─ order: 必须为"asc"或"desc"

3. 构建查询条件
   ├─ 根据 category/status 构建 WHERE 条件
   └─ 根据 sortBy/order 构建 ORDER BY

4. 数据库操作
   ├─ 查询总数(COUNT)
   ├─ 分页查询数据(LIMIT/OFFSET)
   └─ 计算分页元数据

5. 成功返回
```

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "key": "appointment",
        "name": "预约管理",
        "description": "完整的预约管理功能",
        "category": "business",
        "monthlyPrice": 29.99,
        "pricingModel": "fixed",
        "dependencies": ["notification"],
        "status": "ACTIVE",
        "createdAt": "2025-10-14T10:30:00.000Z",
        "updatedAt": "2025-10-14T10:30:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 45,
      "totalPages": 3
    }
  },
  "message": "查询成功"
}
```

**错误响应**: 同上 (401/403/400/500)

---

#### 3. 查询单个模块

**端点**: `GET /api/subscription-service/v1/admin/modules/:id`

**描述**: 根据ID查询模块详情

**请求头**:
```
X-Admin-API-Key: <ADMIN_API_KEY>
```

**路径参数**:
- `id`: 模块UUID

**请求示例**:
```
GET /api/subscription-service/v1/admin/modules/550e8400-e29b-41d4-a716-446655440000
```

**执行逻辑**:
```
1. 鉴权检查 → 验证 X-Admin-API-Key
2. 参数校验 → id: 验证UUID格式
3. 数据库操作 → 根据id查询modules表
4. 业务校验 → 检查模块是否存在
5. 成功返回
```

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "key": "appointment",
    "name": "预约管理",
    "description": "完整的预约管理功能",
    "category": "business",
    "monthlyPrice": 29.99,
    "pricingModel": "fixed",
    "dependencies": ["notification"],
    "status": "ACTIVE",
    "createdAt": "2025-10-14T10:30:00.000Z",
    "updatedAt": "2025-10-14T10:30:00.000Z"
  },
  "message": "查询成功"
}
```

**额外错误响应**:

| HTTP状态码 | 错误代码 | 说明 |
|-----------|---------|------|
| 404 | `MODULE_NOT_FOUND` | 模块不存在 |

---

#### 4. 更新模块

**端点**: `PATCH /api/subscription-service/v1/admin/modules/:id`

**描述**: 更新模块信息(部分更新)

**请求头**:
```
X-Admin-API-Key: <ADMIN_API_KEY>
Content-Type: application/json
```

**路径参数**:
- `id`: 模块UUID

**请求体**:
```typescript
{
  "name": string,           // 可选,模块名称,1-100字符
  "description": string,    // 可选,功能描述,最大1000字符
  "category": string,       // 可选,枚举:"core"|"business"|"marketing"|"analytics"
  "monthlyPrice": number,   // 可选,月费价格,>=0,最多2位小数
  "pricingModel": string,   // 可选,枚举:"fixed"|"per_usage"|"hybrid"
  "dependencies": string[]  // 可选,依赖的其他模块keys
}
```

**注意**:
- `key` 不允许修改(唯一标识)
- `status` 通过专门的端点修改
- 至少提供一个字段

**请求示例**:
```json
{
  "name": "预约管理Pro",
  "monthlyPrice": 39.99,
  "description": "升级版预约管理功能"
}
```

**执行逻辑**:
```
1. 鉴权检查
2. 参数校验 → 至少提供一个更新字段
3. 数据库操作 → 查询模块是否存在
4. 业务校验 → 如果更新dependencies,检查依赖模块是否都存在
5. 数据库操作 → 更新modules表,设置updatedAt
6. 成功返回
```

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "key": "appointment",
    "name": "预约管理Pro",
    "description": "升级版预约管理功能",
    "category": "business",
    "monthlyPrice": 39.99,
    "pricingModel": "fixed",
    "dependencies": ["notification"],
    "status": "ACTIVE",
    "createdAt": "2025-10-14T10:30:00.000Z",
    "updatedAt": "2025-10-14T15:45:00.000Z"
  },
  "message": "模块更新成功"
}
```

---

#### 5. 删除模块 (软删除)

**端点**: `DELETE /api/subscription-service/v1/admin/modules/:id`

**描述**: 软删除模块(将状态设为DEPRECATED)

**请求头**:
```
X-Admin-API-Key: <ADMIN_API_KEY>
```

**路径参数**:
- `id`: 模块UUID

**请求示例**:
```
DELETE /api/subscription-service/v1/admin/modules/550e8400-e29b-41d4-a716-446655440000
```

**执行逻辑**:
```
1. 鉴权检查
2. 参数校验 → id: 验证UUID格式
3. 数据库操作 → 查询模块是否存在
4. 业务校验
   ├─ 检查是否有活跃订阅使用此模块(查询subscription_modules表)
   └─ 检查是否有其他模块依赖此模块(查询modules.dependencies字段)
5. 数据库操作 → 更新status为"DEPRECATED"
6. 成功返回
```

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "key": "appointment",
    "name": "预约管理",
    "status": "DEPRECATED",
    "updatedAt": "2025-10-14T16:00:00.000Z"
  },
  "message": "模块已标记为已弃用"
}
```

**额外错误响应**:

| HTTP状态码 | 错误代码 | 说明 |
|-----------|---------|------|
| 409 | `MODULE_IN_USE` | 模块正在被订阅使用 |
| 409 | `MODULE_HAS_DEPENDENTS` | 模块被其他模块依赖 |

---

#### 6. 更新模块状态

**端点**: `PATCH /api/subscription-service/v1/admin/modules/:id/status`

**描述**: 独立更新模块状态

**请求头**:
```
X-Admin-API-Key: <ADMIN_API_KEY>
Content-Type: application/json
```

**路径参数**:
- `id`: 模块UUID

**请求体**:
```typescript
{
  "status": string  // 必需,枚举:"ACTIVE"|"DEPRECATED"|"SUSPENDED"|"COMING_SOON"
}
```

**请求示例**:
```json
{
  "status": "SUSPENDED"
}
```

**执行逻辑**:
```
1. 鉴权检查
2. 参数校验 → status: 必须在枚举值中
3. 数据库操作 → 查询模块当前状态
4. 业务校验
   ├─ 新状态不能与当前状态相同
   └─ 状态转换规则检查:
       ├─ ACTIVE → DEPRECATED/SUSPENDED (允许)
       ├─ DEPRECATED → ACTIVE (允许,恢复)
       ├─ SUSPENDED → ACTIVE (允许,恢复)
       └─ COMING_SOON → ACTIVE (允许,正式发布)
5. 特殊检查 → 如果设为SUSPENDED,检查活跃订阅数量并警告
6. 数据库操作 → 更新status
7. 成功返回
```

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "key": "appointment",
    "name": "预约管理",
    "status": "SUSPENDED",
    "previousStatus": "ACTIVE",
    "updatedAt": "2025-10-14T16:30:00.000Z",
    "warnings": [
      "此模块有15个活跃订阅,状态变更可能影响用户使用"
    ]
  },
  "message": "模块状态已更新"
}
```

**额外错误响应**:

| HTTP状态码 | 错误代码 | 说明 |
|-----------|---------|------|
| 400 | `STATUS_UNCHANGED` | 状态未变更 |
| 400 | `INVALID_STATUS_TRANSITION` | 非法的状态转换 |

---

## 通用错误代码表

### 通用错误
| 错误代码 | HTTP状态码 | 说明 |
|---------|-----------|------|
| `MISSING_API_KEY` | 401 | 缺少Admin API Key |
| `INVALID_API_KEY` | 403 | 无效的Admin API Key |
| `VALIDATION_ERROR` | 400 | 请求参数验证失败 |
| `STATUS_UNCHANGED` | 400 | 状态未变更 |
| `INVALID_STATUS_TRANSITION` | 400 | 非法的状态转换 |
| `INTERNAL_SERVER_ERROR` | 500 | 服务器内部错误 |

### 模块相关错误
| 错误代码 | HTTP状态码 | 说明 |
|---------|-----------|------|
| `MODULE_NOT_FOUND` | 404 | 模块不存在 |
| `MODULE_KEY_EXISTS` | 409 | 模块标识已存在 |
| `INVALID_DEPENDENCIES` | 400 | 依赖模块不存在 |
| `MODULE_IN_USE` | 409 | 模块正在被订阅使用 |
| `MODULE_HAS_DEPENDENTS` | 409 | 模块被其他模块依赖 |

### 资源相关错误
| 错误代码 | HTTP状态码 | 说明 |
|---------|-----------|------|
| `RESOURCE_NOT_FOUND` | 404 | 资源不存在 |
| `RESOURCE_TYPE_EXISTS` | 409 | 资源类型已存在 |
| `RESOURCE_IN_USE` | 409 | 资源正在使用中 |

### 按量计费相关错误
| 错误代码 | HTTP状态码 | 说明 |
|---------|-----------|------|
| `USAGE_PRICING_NOT_FOUND` | 404 | 按量计费规则不存在 |
| `USAGE_TYPE_EXISTS` | 409 | 使用类型已存在 |

### Standard Plan相关错误
| 错误代码 | HTTP状态码 | 说明 |
|---------|-----------|------|
| `ACTIVE_STANDARD_PLAN_NOT_FOUND` | 404 | 当前没有激活的Standard Plan |
| `STANDARD_PLAN_NOT_FOUND` | 404 | Standard Plan不存在 |
| `INVALID_MODULE_KEYS` | 400 | 包含的模块不存在或已弃用 |
| `INVALID_RESOURCE_QUOTAS` | 400 | 资源配额中包含无效的资源类型 |
| `ALREADY_ACTIVE` | 400 | 该版本已经是激活状态 |
| `CANNOT_ACTIVATE_DELETED` | 400 | 不能激活已删除的版本 |
| `CANNOT_DELETE_ACTIVE` | 409 | 不能删除当前激活的版本 |
| `ALREADY_DELETED` | 400 | 该版本已经被删除 |
| `MULTIPLE_ACTIVE_PLANS` | 500 | 数据异常：存在多个激活的Standard Plan |

### 订阅统计相关错误
| 错误代码 | HTTP状态码 | 说明 |
|---------|-----------|------|
| `INVALID_DATE_RANGE` | 400 | 日期范围无效（起始时间晚于结束时间） |
| `INVALID_PRICE_RANGE` | 400 | 价格范围无效（最低价格大于最高价格） |
| `STATISTICS_CALCULATION_ERROR` | 500 | 统计计算失败 |

---

## 安全建议

### API Key 安全
1. **生成强密钥**: 使用至少32字符的随机字符串
   ```bash
   openssl rand -base64 32
   ```

2. **环境变量隔离**: 不同环境使用不同的API Key
   ```bash
   # .env.development
   ADMIN_API_KEY=dev-key-here

   # .env.production
   ADMIN_API_KEY=prod-key-here
   ```

3. **日志脱敏**: 记录日志时不输出完整API Key
   ```typescript
   const maskedKey = `${key.slice(0, 4)}****${key.slice(-4)}`;
   ```

4. **限流保护**: 对Admin API添加请求频率限制(如60次/分钟)

5. **HTTPS强制**: 生产环境强制使用HTTPS传输

---

### Phase 2: 资源管理 (Resources Management)

#### 1. 创建资源

**端点**: `POST /api/subscription-service/v1/admin/resources`

**描述**: 创建新的资源定价

**请求头**:
```
X-Admin-API-Key: <ADMIN_API_KEY>
Content-Type: application/json
```

**请求体**:
```typescript
{
  "type": string,          // 必需,资源类型,唯一,枚举:"pos"|"kiosk"|"tablet"|"manager"|"staff"
  "category": string,      // 必需,资源分类,枚举:"device"|"account"
  "name": string,          // 必需,资源名称,1-100字符
  "monthlyPrice": number,  // 必需,月费价格,>=0,最多2位小数
  "standardQuota": number, // 必需,Standard Plan包含数量,>=0的整数
  "status": string         // 可选,枚举:"ACTIVE"|"DEPRECATED",默认"ACTIVE"
}
```

**请求示例**:
```json
{
  "type": "pos",
  "category": "device",
  "name": "POS设备",
  "monthlyPrice": 50.00,
  "standardQuota": 2,
  "status": "ACTIVE"
}
```

**执行逻辑**:
```
1. 鉴权检查 → 验证 X-Admin-API-Key
2. 参数校验
   ├─ type: 必须在枚举值中
   ├─ category: 必须在枚举值中
   ├─ name: 非空,长度1-100
   ├─ monthlyPrice: >=0, 最多2位小数
   └─ standardQuota: >=0的整数
3. 业务校验 → 检查 type 是否已存在(唯一索引)
4. 数据库操作 → 插入 resources 表
5. 成功返回
```

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "type": "pos",
    "category": "device",
    "name": "POS设备",
    "monthlyPrice": 50.00,
    "standardQuota": 2,
    "status": "ACTIVE",
    "createdAt": "2025-10-14T10:30:00.000Z",
    "updatedAt": "2025-10-14T10:30:00.000Z"
  },
  "message": "资源创建成功"
}
```

**错误响应**:
- 401 `MISSING_API_KEY` - 缺少Admin API Key
- 403 `INVALID_API_KEY` - 无效的Admin API Key
- 400 `VALIDATION_ERROR` - 请求参数验证失败
- 409 `RESOURCE_TYPE_EXISTS` - 资源类型已存在
- 500 `INTERNAL_SERVER_ERROR` - 服务器内部错误

---

#### 2. 列出所有资源

**端点**: `GET /api/subscription-service/v1/admin/resources`

**描述**: 分页查询资源列表,支持筛选和排序

**请求头**:
```
X-Admin-API-Key: <ADMIN_API_KEY>
```

**查询参数**:
```typescript
{
  "page": number,      // 可选,页码,从1开始,默认1
  "limit": number,     // 可选,每页数量,1-100,默认20
  "category": string,  // 可选,筛选分类:"device"|"account"
  "status": string,    // 可选,筛选状态:"ACTIVE"|"DEPRECATED"
  "sortBy": string,    // 可选,排序字段:"createdAt"|"monthlyPrice"|"name",默认"createdAt"
  "order": string      // 可选,排序方向:"asc"|"desc",默认"desc"
}
```

**请求示例**:
```
GET /api/subscription-service/v1/admin/resources?page=1&limit=20&category=device&status=ACTIVE&sortBy=monthlyPrice&order=asc
```

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "type": "pos",
        "category": "device",
        "name": "POS设备",
        "monthlyPrice": 50.00,
        "standardQuota": 2,
        "status": "ACTIVE",
        "createdAt": "2025-10-14T10:30:00.000Z",
        "updatedAt": "2025-10-14T10:30:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 5,
      "totalPages": 1
    }
  },
  "message": "查询成功"
}
```

---

#### 3. 查询单个资源

**端点**: `GET /api/subscription-service/v1/admin/resources/:id`

**描述**: 根据ID查询资源详情

**请求头**:
```
X-Admin-API-Key: <ADMIN_API_KEY>
```

**路径参数**:
- `id`: 资源UUID

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "type": "pos",
    "category": "device",
    "name": "POS设备",
    "monthlyPrice": 50.00,
    "standardQuota": 2,
    "status": "ACTIVE",
    "createdAt": "2025-10-14T10:30:00.000Z",
    "updatedAt": "2025-10-14T10:30:00.000Z"
  },
  "message": "查询成功"
}
```

**错误响应**:
- 404 `RESOURCE_NOT_FOUND` - 资源不存在

---

#### 4. 更新资源

**端点**: `PATCH /api/subscription-service/v1/admin/resources/:id`

**描述**: 更新资源信息(部分更新)

**请求头**:
```
X-Admin-API-Key: <ADMIN_API_KEY>
Content-Type: application/json
```

**路径参数**:
- `id`: 资源UUID

**请求体** (所有字段可选,至少提供一个):
```typescript
{
  "category": string,      // 可选,资源分类
  "name": string,          // 可选,资源名称
  "monthlyPrice": number,  // 可选,月费价格
  "standardQuota": number  // 可选,Standard Plan包含数量
}
```

**注意**:
- `type` 不允许修改(唯一标识)
- `status` 通过专门的端点修改
- 至少提供一个字段

**请求示例**:
```json
{
  "name": "POS设备Pro",
  "monthlyPrice": 60.00
}
```

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "type": "pos",
    "category": "device",
    "name": "POS设备Pro",
    "monthlyPrice": 60.00,
    "standardQuota": 2,
    "status": "ACTIVE",
    "createdAt": "2025-10-14T10:30:00.000Z",
    "updatedAt": "2025-10-14T16:00:00.000Z"
  },
  "message": "资源更新成功"
}
```

---

#### 5. 删除资源 (软删除)

**端点**: `DELETE /api/subscription-service/v1/admin/resources/:id`

**描述**: 软删除资源(将状态设为DEPRECATED)

**请求头**:
```
X-Admin-API-Key: <ADMIN_API_KEY>
```

**路径参数**:
- `id`: 资源UUID

**执行逻辑**:
```
1. 鉴权检查
2. 参数校验 → id: 验证UUID格式
3. 数据库操作 → 查询资源是否存在
4. 业务校验 → 检查是否有活跃订阅使用此资源(查询subscription_resources表)
5. 数据库操作 → 更新status为"DEPRECATED"
6. 成功返回
```

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "type": "pos",
    "name": "POS设备",
    "status": "DEPRECATED",
    "updatedAt": "2025-10-14T16:30:00.000Z"
  },
  "message": "资源已标记为已弃用"
}
```

**错误响应**:
- 409 `RESOURCE_IN_USE` - 资源正在使用中

---

#### 6. 更新资源状态

**端点**: `PATCH /api/subscription-service/v1/admin/resources/:id/status`

**描述**: 独立更新资源状态

**请求头**:
```
X-Admin-API-Key: <ADMIN_API_KEY>
Content-Type: application/json
```

**路径参数**:
- `id`: 资源UUID

**请求体**:
```typescript
{
  "status": string  // 必需,枚举:"ACTIVE"|"DEPRECATED"
}
```

**请求示例**:
```json
{
  "status": "DEPRECATED"
}
```

**执行逻辑**:
```
1. 鉴权检查
2. 参数校验 → status: 必须在枚举值中
3. 数据库操作 → 查询资源当前状态
4. 业务校验 → 新状态不能与当前状态相同
5. 状态转换规则:
   ├─ ACTIVE → DEPRECATED (允许)
   └─ DEPRECATED → ACTIVE (允许,恢复)
6. 特殊检查 → 如果设为DEPRECATED,检查活跃订阅数量并警告
7. 数据库操作 → 更新status
8. 成功返回
```

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "type": "pos",
    "name": "POS设备",
    "status": "DEPRECATED",
    "previousStatus": "ACTIVE",
    "updatedAt": "2025-10-14T17:00:00.000Z",
    "warnings": ["此资源有8个活跃订阅,状态变更可能影响用户使用"]
  },
  "message": "资源状态已更新"
}
```

**错误响应**:
- 400 `STATUS_UNCHANGED` - 状态未变更

---

### Phase 3: 按量计费管理 (Usage Pricing Management)

#### 1. 创建按量计费规则

**端点**: `POST /api/subscription-service/v1/admin/usage-pricing`

**描述**: 创建新的按量计费规则

**请求头**:
```
X-Admin-API-Key: <ADMIN_API_KEY>
Content-Type: application/json
```

**请求体**:
```typescript
{
  "usageType": string,      // 必需,使用类型,唯一,3-50字符,小写字母+数字+下划线,必须以字母开头
  "displayName": string,    // 必需,显示名称,1-100字符
  "unitPrice": number,      // 必需,单价,>=0,最多4位小数
  "currency": string,       // 可选,货币类型,枚举:"CAD",默认"CAD"
  "isActive": boolean       // 可选,是否启用,默认true
}
```

**请求示例**:
```json
{
  "usageType": "sms_send",
  "displayName": "发送短信",
  "unitPrice": 0.0150,
  "currency": "CAD",
  "isActive": true
}
```

**执行逻辑**:
```
1. 鉴权检查 → 验证 X-Admin-API-Key
2. 参数校验
   ├─ usageType: 格式正则 /^[a-z][a-z0-9_]*$/,长度3-50
   ├─ displayName: 非空,长度1-100
   ├─ unitPrice: >=0, 最多4位小数
   ├─ currency: 必须为"CAD"
   └─ isActive: 布尔值
3. 业务校验 → 检查 usageType 是否已存在(唯一索引)
4. 数据库操作 → 插入 usage_pricing 表
5. 成功返回
```

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "usageType": "sms_send",
    "displayName": "发送短信",
    "unitPrice": 0.0150,
    "currency": "CAD",
    "isActive": true,
    "createdAt": "2025-10-18T10:30:00.000Z",
    "updatedAt": "2025-10-18T10:30:00.000Z"
  },
  "message": "按量计费规则创建成功"
}
```

**错误响应**:
- 401 `MISSING_API_KEY` - 缺少Admin API Key
- 403 `INVALID_API_KEY` - 无效的Admin API Key
- 400 `VALIDATION_ERROR` - 请求参数验证失败
- 409 `USAGE_TYPE_EXISTS` - 使用类型已存在
- 500 `INTERNAL_SERVER_ERROR` - 服务器内部错误

---

#### 2. 列出所有按量计费规则

**端点**: `GET /api/subscription-service/v1/admin/usage-pricing`

**描述**: 分页查询按量计费规则列表,支持筛选和排序

**请求头**:
```
X-Admin-API-Key: <ADMIN_API_KEY>
```

**查询参数**:
```typescript
{
  "page": number,      // 可选,页码,从1开始,默认1
  "limit": number,     // 可选,每页数量,1-100,默认20
  "isActive": boolean, // 可选,筛选状态:true(启用)|false(禁用)
  "sortBy": string,    // 可选,排序字段:"createdAt"|"unitPrice"|"displayName",默认"createdAt"
  "order": string      // 可选,排序方向:"asc"|"desc",默认"desc"
}
```

**请求示例**:
```
GET /api/subscription-service/v1/admin/usage-pricing?page=1&limit=20&isActive=true&sortBy=unitPrice&order=asc
```

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "usageType": "sms_send",
        "displayName": "发送短信",
        "unitPrice": 0.0150,
        "currency": "CAD",
        "isActive": true,
        "createdAt": "2025-10-18T10:30:00.000Z",
        "updatedAt": "2025-10-18T10:30:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 8,
      "totalPages": 1
    }
  },
  "message": "查询成功"
}
```

---

#### 3. 查询单个按量计费规则

**端点**: `GET /api/subscription-service/v1/admin/usage-pricing/:id`

**描述**: 根据ID查询按量计费规则详情

**请求头**:
```
X-Admin-API-Key: <ADMIN_API_KEY>
```

**路径参数**:
- `id`: 按量计费规则UUID

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "usageType": "sms_send",
    "displayName": "发送短信",
    "unitPrice": 0.0150,
    "currency": "CAD",
    "isActive": true,
    "createdAt": "2025-10-18T10:30:00.000Z",
    "updatedAt": "2025-10-18T10:30:00.000Z"
  },
  "message": "查询成功"
}
```

**错误响应**:
- 404 `USAGE_PRICING_NOT_FOUND` - 按量计费规则不存在

---

#### 4. 更新按量计费规则

**端点**: `PATCH /api/subscription-service/v1/admin/usage-pricing/:id`

**描述**: 更新按量计费规则信息(部分更新)

**请求头**:
```
X-Admin-API-Key: <ADMIN_API_KEY>
Content-Type: application/json
```

**路径参数**:
- `id`: 按量计费规则UUID

**请求体** (所有字段可选,至少提供一个):
```typescript
{
  "displayName": string,  // 可选,显示名称,1-100字符
  "unitPrice": number     // 可选,单价,>=0,最多4位小数
}
```

**注意**:
- `usageType` 不允许修改(唯一标识)
- `currency` 不允许修改(固定CAD)
- `isActive` 通过专门的端点修改
- 至少提供一个字段

**请求示例**:
```json
{
  "displayName": "发送短信(国内)",
  "unitPrice": 0.0180
}
```

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "usageType": "sms_send",
    "displayName": "发送短信(国内)",
    "unitPrice": 0.0180,
    "currency": "CAD",
    "isActive": true,
    "createdAt": "2025-10-18T10:30:00.000Z",
    "updatedAt": "2025-10-18T16:00:00.000Z"
  },
  "message": "按量计费规则更新成功"
}
```

---

#### 5. 更新按量计费规则状态（启用/禁用）

**端点**: `PATCH /api/subscription-service/v1/admin/usage-pricing/:id/status`

**描述**: 独立更新按量计费规则的启用/禁用状态

**请求头**:
```
X-Admin-API-Key: <ADMIN_API_KEY>
Content-Type: application/json
```

**路径参数**:
- `id`: 按量计费规则UUID

**请求体**:
```typescript
{
  "isActive": boolean  // 必需,是否启用: true(启用)|false(禁用)
}
```

**请求示例**:
```json
{
  "isActive": false
}
```

**执行逻辑**:
```
1. 鉴权检查
2. 参数校验 → isActive: 必须为布尔值
3. 数据库操作 → 查询规则当前状态
4. 业务校验 → 新状态不能与当前状态相同
5. 特殊检查 → 如果禁用(isActive=false),检查未结算使用记录数量
   └─ 查询 usage 表中 usageType 匹配且 billedAt 为 null 的记录数
6. 数据库操作 → 更新isActive字段
7. 成功返回 (包含警告信息,如有)
```

**成功响应** (200 OK):

*情况1: 禁用规则,存在未结算记录*
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "usageType": "sms_send",
    "displayName": "发送短信",
    "unitPrice": 0.0150,
    "currency": "CAD",
    "isActive": false,
    "previousStatus": true,
    "updatedAt": "2025-10-18T16:30:00.000Z",
    "warnings": [
      "此计费规则有237条未结算的使用记录,禁用后不影响已产生的费用"
    ]
  },
  "message": "按量计费规则状态已更新"
}
```

*情况2: 启用规则*
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "usageType": "sms_send",
    "displayName": "发送短信",
    "unitPrice": 0.0150,
    "currency": "CAD",
    "isActive": true,
    "previousStatus": false,
    "updatedAt": "2025-10-18T17:00:00.000Z"
  },
  "message": "按量计费规则状态已更新"
}
```

**错误响应**:
- 400 `STATUS_UNCHANGED` - 状态未变更(新状态与当前状态相同)

**设计说明**:
- ⚠️ Phase 3 不提供 DELETE 端点,只能通过禁用(isActive=false)来停止使用
- 禁用后不会删除历史使用记录,已产生的费用仍可正常结算
- 启用状态使用布尔值(isActive)而非枚举,只有两种状态:启用/禁用

---

### Phase 4: Standard Plan管理 (Standard Plan Management)

#### 概述

Standard Plan是系统的基础订阅套餐，支持多版本管理，同一时间只能有一个激活版本。

**状态转换流程**:
```
创建 → PENDING（待激活）
         ↓
    PENDING → ACTIVE（激活时，旧ACTIVE→ARCHIVED）
         ↓
    PENDING → DELETED（软删除）

    ACTIVE → ARCHIVED（被新版本替代时自动转换）

    ARCHIVED → ACTIVE（重新激活，旧ACTIVE→ARCHIVED）
```

**核心特性**:
- 支持多版本：可创建多个版本作为历史记录或备选方案
- 状态管理：PENDING（待激活）、ACTIVE（当前生效）、ARCHIVED（历史版本）、DELETED（已删除）
- 引用完整性：自动验证包含的模块和资源配额的有效性
- 事务激活：激活新版本时自动归档旧版本，保证唯一性
- 软删除：只能删除PENDING状态的版本，不丢失历史数据

**状态限制**:
- ❌ PENDING → ARCHIVED（不能直接归档待定的）
- ❌ ARCHIVED → DELETED（不能删除已归档的）
- ❌ 更新 ARCHIVED 或 DELETED 的记录
- ❌ 单独激活某个（必须同时归档另一个）

---

#### 1. 创建Standard Plan

**端点**: `POST /api/subscription-service/v1/admin/standard-plan`

**描述**: 创建新的Standard Plan版本

**请求头**:
```
X-Admin-API-Key: <ADMIN_API_KEY>
Content-Type: application/json
```

**请求体**:
```typescript
{
  "name": string,                    // 必需,名称,1-100字符
  "version": string,                 // 必需,版本号,1-50字符,必须唯一
  "description": string,             // 可选,描述,最大1000字符
  "monthlyPrice": number,            // 必需,月费,>=0,最多2位小数
  "includedModuleKeys": string[],    // 必需,包含的模块keys数组（注意：key区分大小写）
  "resourceQuotas": {                // 必需,资源配额对象
    "pos": number,                   // POS数量,>=0的整数
    "kiosk": number,                 // Kiosk数量
    "tablet": number,                // Tablet数量
    "manager": number,               // Manager数量
    "staff": number                  // Staff数量
  },
  "trialDurationDays": number,       // 必需,试用期天数,>=0的整数
  "trialSmsQuota": number            // 必需,试用期短信配额,>=0的整数
}
```

**请求示例**:
```json
{
  "name": "Standard Plan 2025-Q1",
  "version": "v2.0",
  "description": "新年促销版本，增加预约模块",
  "monthlyPrice": 199.00,
  "includedModuleKeys": ["appointment", "member", "notification"],
  "resourceQuotas": {
    "pos": 2,
    "kiosk": 1,
    "tablet": 0,
    "manager": 1,
    "staff": 3
  },
  "trialDurationDays": 30,
  "trialSmsQuota": 100
}
```

**执行逻辑**:
```
1. 鉴权检查 → 验证 X-Admin-API-Key
2. 参数校验 → 验证所有必需字段和数据类型
3. 引用完整性验证:
   ├─ includedModuleKeys: 批量查询modules表，检查所有keys存在且状态为ACTIVE或COMING_SOON
   └─ resourceQuotas: 批量查询resources表，检查所有types存在且状态为ACTIVE
4. 创建新版本为PENDING状态（待激活）
5. 返回创建结果

注意：新创建的版本始终为PENDING状态，需要调用激活接口才能生效
```

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Standard Plan 2025-Q1",
    "version": "v2.0",
    "description": "新年促销版本，增加预约模块",
    "monthlyPrice": 199.00,
    "includedModuleKeys": ["appointment", "member", "notification"],
    "resourceQuotas": {
      "pos": 2,
      "kiosk": 1,
      "tablet": 0,
      "manager": 1,
      "staff": 3
    },
    "trialDurationDays": 30,
    "trialSmsQuota": 100,
    "status": "PENDING",
    "activatedAt": null,
    "archivedAt": null,
    "deletedAt": null,
    "createdAt": "2025-10-18T16:00:00.000Z",
    "updatedAt": "2025-10-18T16:00:00.000Z"
  },
  "message": "Standard Plan创建成功"
}
```

**错误响应**:
- 401 `MISSING_API_KEY` - 缺少Admin API Key
- 403 `INVALID_API_KEY` - 无效的Admin API Key
- 400 `VALIDATION_ERROR` - 请求参数验证失败
- 400 `INVALID_MODULE_KEYS` - 包含的模块不存在或已弃用
- 400 `INVALID_RESOURCE_QUOTAS` - 资源配额中包含无效的资源类型
- 409 `VERSION_ALREADY_EXISTS` - 版本号已存在，请使用不同的版本号
- 500 `INTERNAL_SERVER_ERROR` - 服务器内部错误

---

#### 2. 查询当前ACTIVE的Standard Plan

**端点**: `GET /api/subscription-service/v1/admin/standard-plan`

**描述**: 查询当前激活的Standard Plan配置

**请求头**:
```
X-Admin-API-Key: <ADMIN_API_KEY>
```

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Standard Plan 2025-Q1",
    "version": "v2.0",
    "description": "新年促销版本，增加预约模块",
    "monthlyPrice": 199.00,
    "includedModuleKeys": ["appointment", "member", "notification"],
    "resourceQuotas": {
      "pos": 2,
      "kiosk": 1,
      "tablet": 0,
      "manager": 1,
      "staff": 3
    },
    "trialDurationDays": 30,
    "trialSmsQuota": 100,
    "status": "ACTIVE",
    "activatedAt": "2025-10-18T16:00:00.000Z",
    "createdAt": "2025-10-18T16:00:00.000Z",
    "updatedAt": "2025-10-18T16:00:00.000Z"
  },
  "message": "查询成功"
}
```

**错误响应**:
- 404 `ACTIVE_STANDARD_PLAN_NOT_FOUND` - 当前没有激活的Standard Plan

---

#### 3. 列出所有Standard Plan版本

**端点**: `GET /api/subscription-service/v1/admin/standard-plan/list`

**描述**: 分页查询所有Standard Plan版本，支持筛选和排序

**请求头**:
```
X-Admin-API-Key: <ADMIN_API_KEY>
```

**查询参数**:
```typescript
{
  "page": number,                    // 可选,页码,默认1
  "limit": number,                   // 可选,每页数量,1-50,默认20
  "status": string,                  // 可选,筛选状态:"ACTIVE"|"ARCHIVED"|"DELETED"
  "includeDeleted": boolean,         // 可选,是否包含已删除,默认false
  "sortBy": string,                  // 可选,排序字段:"createdAt"|"activatedAt"|"monthlyPrice",默认"createdAt"
  "order": string                    // 可选,排序方向:"asc"|"desc",默认"desc"
}
```

**请求示例**:
```
GET /api/subscription-service/v1/admin/standard-plan/list?page=1&limit=20&sortBy=createdAt&order=desc
```

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid-1",
        "name": "Standard Plan 2025-Q1",
        "version": "v2.0",
        "monthlyPrice": 199.00,
        "status": "ACTIVE",
        "activatedAt": "2025-10-18T16:00:00.000Z",
        "createdAt": "2025-10-18T16:00:00.000Z"
      },
      {
        "id": "uuid-2",
        "name": "Standard Plan 2024-Q4",
        "version": "v1.0",
        "monthlyPrice": 179.00,
        "status": "ARCHIVED",
        "activatedAt": "2024-10-01T00:00:00.000Z",
        "archivedAt": "2025-10-18T16:00:00.000Z",
        "createdAt": "2024-10-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 2,
      "totalPages": 1
    }
  },
  "message": "查询成功"
}
```

---

#### 4. 查询单个Standard Plan

**端点**: `GET /api/subscription-service/v1/admin/standard-plan/:id`

**描述**: 根据ID查询指定Standard Plan版本的完整信息

**请求头**:
```
X-Admin-API-Key: <ADMIN_API_KEY>
```

**路径参数**:
- `id`: Standard Plan UUID

**请求示例**:
```
GET /api/subscription-service/v1/admin/standard-plan/550e8400-e29b-41d4-a716-446655440000
```

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Standard Plan 2024-Q4",
    "version": "v1.0",
    "description": "年度标准版本",
    "monthlyPrice": 179.00,
    "includedModuleKeys": ["member", "notification"],
    "resourceQuotas": {
      "pos": 2,
      "kiosk": 1,
      "tablet": 0,
      "manager": 1,
      "staff": 3
    },
    "trialDurationDays": 30,
    "trialSmsQuota": 100,
    "status": "ARCHIVED",
    "activatedAt": "2024-10-01T00:00:00.000Z",
    "archivedAt": "2025-10-18T16:00:00.000Z",
    "deletedAt": null,
    "createdAt": "2024-10-01T00:00:00.000Z",
    "updatedAt": "2025-10-18T16:00:00.000Z"
  },
  "message": "查询成功"
}
```

**错误响应**:
- 404 `STANDARD_PLAN_NOT_FOUND` - Standard Plan不存在

---

#### 5. 更新Standard Plan

**端点**: `PATCH /api/subscription-service/v1/admin/standard-plan/:id`

**描述**: 更新Standard Plan版本信息（部分更新）

**状态限制**: 只能更新 PENDING 或 ACTIVE 状态的版本，ARCHIVED 和 DELETED 状态禁止更新

**请求头**:
```
X-Admin-API-Key: <ADMIN_API_KEY>
Content-Type: application/json
```

**路径参数**:
- `id`: Standard Plan UUID

**请求体** (所有字段可选，至少提供一个):
```typescript
{
  "name": string,                    // 可选,名称,1-100字符
  "version": string,                 // 可选,版本号,1-50字符
  "description": string,             // 可选,描述,最大1000字符
  "monthlyPrice": number,            // 可选,月费,>=0,最多2位小数
  "includedModuleKeys": string[],    // 可选,包含的模块keys数组
  "resourceQuotas": {                // 可选,资源配额对象
    "pos": number,
    "kiosk": number,
    "tablet": number,
    "manager": number,
    "staff": number
  },
  "trialDurationDays": number,       // 可选,试用期天数,>=0的整数
  "trialSmsQuota": number            // 可选,试用期短信配额,>=0的整数
}
```

**注意**:
- `status` 不通过此端点修改，使用专门的激活/删除端点
- 至少提供一个字段
- 如果更新ACTIVE状态的版本，会检查活跃订阅数量并返回警告

**请求示例**:
```json
{
  "name": "Standard Plan 2025-Q1 Pro",
  "monthlyPrice": 209.00,
  "includedModuleKeys": ["appointment", "member", "notification", "analytics"]
}
```

**执行逻辑**:
```
1. 鉴权检查 → 验证 X-Admin-API-Key
2. 参数校验 → 至少提供一个更新字段
3. 数据库操作 → 查询Standard Plan是否存在
4. 引用完整性验证（如果提供）:
   ├─ includedModuleKeys: 验证所有keys存在且状态为ACTIVE或COMING_SOON
   └─ resourceQuotas: 验证所有types存在且状态为ACTIVE
5. 业务检查 → 如果是ACTIVE版本，统计活跃订阅数量
6. 数据库操作 → 更新Standard Plan
7. 成功返回（包含警告，如有）
```

**成功响应** (200 OK - 更新ACTIVE版本):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Standard Plan 2025-Q1 Pro",
    "version": "v2.0",
    "description": "新年促销版本，增加预约模块",
    "monthlyPrice": 209.00,
    "includedModuleKeys": ["appointment", "member", "notification", "analytics"],
    "resourceQuotas": {
      "pos": 2,
      "kiosk": 1,
      "tablet": 0,
      "manager": 1,
      "staff": 3
    },
    "trialDurationDays": 30,
    "trialSmsQuota": 100,
    "status": "ACTIVE",
    "activatedAt": "2025-10-18T16:00:00.000Z",
    "createdAt": "2025-10-18T16:00:00.000Z",
    "updatedAt": "2025-10-18T18:00:00.000Z",
    "warnings": [
      "此Standard Plan当前有45个活跃订阅，更新可能影响用户"
    ]
  },
  "message": "Standard Plan更新成功"
}
```

**错误响应**:
- 404 `STANDARD_PLAN_NOT_FOUND` - Standard Plan不存在
- 400 `CANNOT_UPDATE_ARCHIVED` - 不能更新已归档的版本
- 400 `CANNOT_UPDATE_DELETED` - 不能更新已删除的版本
- 400 `INVALID_MODULE_KEYS` - 包含的模块不存在或已弃用
- 400 `INVALID_RESOURCE_QUOTAS` - 资源配额中包含无效的资源类型

---

#### 6. 激活Standard Plan

**端点**: `PATCH /api/subscription-service/v1/admin/standard-plan/:id/activate`

**描述**: 激活PENDING或ARCHIVED状态的Standard Plan版本，自动归档当前ACTIVE版本

**状态限制**: 只能激活 PENDING 或 ARCHIVED 状态的版本

**请求头**:
```
X-Admin-API-Key: <ADMIN_API_KEY>
```

**路径参数**:
- `id`: Standard Plan UUID（必须是PENDING或ARCHIVED状态）

**请求示例**:
```
PATCH /api/subscription-service/v1/admin/standard-plan/550e8400-e29b-41d4-a716-446655440000/activate
```

**执行逻辑**:
```
1. 鉴权检查 → 验证 X-Admin-API-Key
2. 数据库操作 → 查询要激活的版本
3. 业务校验:
   ├─ 检查版本是否存在
   ├─ 检查是否已经是ACTIVE状态 → 返回错误
   └─ 检查是否是DELETED状态 → 返回错误（不能激活已删除版本）
4. 在事务中:
   ├─ 查询当前所有ACTIVE版本
   ├─ 安全检查：确保最多只有1个ACTIVE（数据一致性）
   ├─ 将所有ACTIVE版本更新为ARCHIVED状态
   └─ 将目标版本更新为ACTIVE状态
5. 成功返回（包含归档的旧版本信息）
```

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Standard Plan 2024-Q4",
    "version": "v1.0",
    "description": "年度标准版本",
    "monthlyPrice": 179.00,
    "includedModuleKeys": ["member", "notification"],
    "resourceQuotas": {
      "pos": 2,
      "kiosk": 1,
      "tablet": 0,
      "manager": 1,
      "staff": 3
    },
    "trialDurationDays": 30,
    "trialSmsQuota": 100,
    "status": "ACTIVE",
    "activatedAt": "2025-10-18T18:30:00.000Z",
    "archivedAt": null,
    "createdAt": "2024-10-01T00:00:00.000Z",
    "updatedAt": "2025-10-18T18:30:00.000Z",
    "archivedPreviousPlan": {
      "id": "uuid-previous",
      "version": "v2.0",
      "archivedAt": "2025-10-18T18:30:00.000Z"
    }
  },
  "message": "Standard Plan已激活"
}
```

**错误响应**:
- 404 `STANDARD_PLAN_NOT_FOUND` - Standard Plan不存在
- 400 `ALREADY_ACTIVE` - 该版本已经是激活状态
- 400 `CANNOT_ACTIVATE_DELETED` - 不能激活已删除的版本
- 500 `MULTIPLE_ACTIVE_PLANS` - 数据异常：存在多个激活的Standard Plan

---

#### 7. 删除Standard Plan（软删除）

**端点**: `DELETE /api/subscription-service/v1/admin/standard-plan/:id`

**描述**: 软删除Standard Plan版本（仅限PENDING状态）

**状态限制**: 只能删除 PENDING 状态的版本，ACTIVE 和 ARCHIVED 状态禁止删除

**请求头**:
```
X-Admin-API-Key: <ADMIN_API_KEY>
```

**路径参数**:
- `id`: Standard Plan UUID（必须是PENDING状态）

**请求示例**:
```
DELETE /api/subscription-service/v1/admin/standard-plan/550e8400-e29b-41d4-a716-446655440000
```

**执行逻辑**:
```
1. 鉴权检查 → 验证 X-Admin-API-Key
2. 数据库操作 → 查询版本是否存在
3. 业务校验:
   ├─ 检查是否是ACTIVE状态 → 返回错误（不能删除当前激活版本）
   ├─ 检查是否是ARCHIVED状态 → 返回错误（不能删除已归档版本）
   ├─ 检查是否已经是DELETED状态 → 返回错误
   └─ 检查是否是PENDING状态 → 允许删除
4. 数据库操作 → 更新status为DELETED，设置deletedAt
5. 成功返回（仅返回部分字段）
```

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Standard Plan 2023-Q4",
    "version": "v0.9",
    "status": "DELETED",
    "previousStatus": "ARCHIVED",
    "deletedAt": "2025-10-18T19:00:00.000Z",
    "updatedAt": "2025-10-18T19:00:00.000Z"
  },
  "message": "Standard Plan已删除"
}
```

**错误响应**:
- 404 `STANDARD_PLAN_NOT_FOUND` - Standard Plan不存在
- 409 `CANNOT_DELETE_ACTIVE` - 不能删除当前激活的版本
- 409 `CANNOT_DELETE_ARCHIVED` - 不能删除已归档的版本
- 400 `ALREADY_DELETED` - 该版本已经被删除
- 400 `INVALID_STATUS_FOR_DELETION` - 只能删除PENDING状态的版本

**设计说明**:
- ⚠️ 只能删除PENDING状态的版本
- ACTIVE 和 ARCHIVED 状态的版本不能删除（保护历史数据）
- 软删除不会物理删除数据，可通过includeDeleted参数查询

---

### Phase 5: 订阅统计查询 (Subscription Statistics)

#### 概述

订阅统计查询API为管理员提供全局业务指标统计和订阅列表查询功能，帮助管理员了解业务运营状况。

**核心特性**:
- 全局统计：订阅概览、收入指标、转化率、趋势分析
- 支付健康：发票统计、成功率分析
- 资源使用：模块和资源订阅统计
- 列表查询：支持多维度筛选、分页、排序
- 详细摘要：订阅详情包含模块、资源、使用量信息

---

#### 1. 获取订阅统计数据

**端点**: `GET /api/subscription-service/v1/admin/statistics`

**描述**: 获取全局订阅统计和业务指标

**请求头**:
```
X-Admin-API-Key: <ADMIN_API_KEY>
```

**查询参数** (可选):
```typescript
{
  "from": string,   // 可选,统计起始时间(ISO 8601),默认本月1日
  "to": string      // 可选,统计结束时间(ISO 8601),默认当前时间
}
```

**请求示例**:
```
GET /api/subscription-service/v1/admin/statistics
GET /api/subscription-service/v1/admin/statistics?from=2025-10-01T00:00:00Z&to=2025-10-18T23:59:59Z
```

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "overview": {
      "totalSubscriptions": 150,
      "activeSubscriptions": 120,
      "trialSubscriptions": 25,
      "expiredSubscriptions": 3,
      "suspendedSubscriptions": 2,
      "cancelledSubscriptions": 45
    },
    "revenue": {
      "monthlyRecurringRevenue": 23880.00,
      "averageRevenuePerUser": 199.00,
      "totalMonthlyPotential": 28855.00
    },
    "conversion": {
      "trialToActiveCount": 18,
      "trialToActiveRate": 72.00,
      "totalTrialStarted": 25,
      "totalTrialEnded": 20
    },
    "trends": {
      "newSubscriptionsThisMonth": 32,
      "newSubscriptionsThisWeek": 8,
      "newSubscriptionsToday": 2,
      "cancellationsThisMonth": 5,
      "cancellationRate": 3.33,
      "netGrowthThisMonth": 27
    },
    "upcoming": {
      "subscriptionsRenewingIn7Days": 15,
      "subscriptionsRenewingIn30Days": 58,
      "trialsExpiringIn7Days": 8,
      "trialsExpiringToday": 1,
      "subscriptionsInGracePeriod": 2
    },
    "paymentHealth": {
      "failedInvoicesCount": 3,
      "failedInvoicesAmount": 597.00,
      "pendingInvoicesCount": 12,
      "pendingInvoicesAmount": 2388.00,
      "successRate": 95.50
    },
    "resourceUsage": {
      "totalModuleSubscriptions": 180,
      "totalExtraResources": 95,
      "averageModulesPerSubscription": 1.20,
      "averageExtraResourcesPerSubscription": 0.63
    },
    "paymentProviders": {
      "stripe": 105,
      "paypal": 40,
      "none": 5
    }
  },
  "message": "统计查询成功"
}
```

**数据字段说明**:
- **overview**: 订阅概览
  - `totalSubscriptions`: 总订阅数（不含CANCELLED）
  - `activeSubscriptions`: ACTIVE状态订阅数
  - `trialSubscriptions`: TRIAL状态订阅数
  - `expiredSubscriptions`: EXPIRED状态订阅数
  - `suspendedSubscriptions`: SUSPENDED状态订阅数
  - `cancelledSubscriptions`: CANCELLED状态订阅数（全部历史）

- **revenue**: 收入指标
  - `monthlyRecurringRevenue`: MRR，仅ACTIVE订阅的standardPrice总和
  - `averageRevenuePerUser`: ARPU，MRR / ACTIVE订阅数
  - `totalMonthlyPotential`: 潜在月收入，包含TRIAL转化后的收入

- **conversion**: 转化指标
  - `trialToActiveCount`: 本期从TRIAL转为ACTIVE的订阅数
  - `trialToActiveRate`: 试用转化率（percentage）
  - `totalTrialStarted`: 本期开始的试用总数
  - `totalTrialEnded`: 本期结束的试用总数

- **trends**: 趋势数据
  - `newSubscriptionsThisMonth`: 本月新增订阅数
  - `newSubscriptionsThisWeek`: 本周新增订阅数
  - `newSubscriptionsToday`: 今日新增订阅数
  - `cancellationsThisMonth`: 本月取消订阅数
  - `cancellationRate`: 取消率（percentage）
  - `netGrowthThisMonth`: 本月净增长（新增-取消）

- **upcoming**: 即将发生的事件
  - `subscriptionsRenewingIn7Days`: 7天内需续费的订阅数
  - `subscriptionsRenewingIn30Days`: 30天内需续费的订阅数
  - `trialsExpiringIn7Days`: 7天内试用到期的订阅数
  - `trialsExpiringToday`: 今日试用到期的订阅数
  - `subscriptionsInGracePeriod`: 宽限期内的订阅数

- **paymentHealth**: 支付健康度
  - `failedInvoicesCount`: 支付失败的发票数（FAILED状态）
  - `failedInvoicesAmount`: 失败发票总金额
  - `pendingInvoicesCount`: 待支付发票数（PENDING状态）
  - `pendingInvoicesAmount`: 待支付发票总金额
  - `successRate`: 支付成功率（percentage）

- **resourceUsage**: 资源使用统计
  - `totalModuleSubscriptions`: 总模块订阅数量
  - `totalExtraResources`: 总额外资源购买数量
  - `averageModulesPerSubscription`: 平均每个订阅的模块数
  - `averageExtraResourcesPerSubscription`: 平均每个订阅的额外资源数

- **paymentProviders**: 支付方式分布
  - `stripe`: 使用Stripe的订阅数
  - `paypal`: 使用PayPal的订阅数
  - `none`: 未绑定支付方式的订阅数（试用中）

**错误响应**:
- 401 `MISSING_API_KEY` - 缺少Admin API Key
- 403 `INVALID_API_KEY` - 无效的Admin API Key
- 400 `VALIDATION_ERROR` - 请求参数验证失败
- 400 `INVALID_DATE_RANGE` - 日期范围无效（起始时间晚于结束时间）
- 500 `STATISTICS_CALCULATION_ERROR` - 统计计算失败

---

#### 2. 列出订阅（分页查询）

**端点**: `GET /api/subscription-service/v1/admin/subscriptions/list`

**描述**: 分页查询订阅列表，支持多维度筛选和排序

**请求头**:
```
X-Admin-API-Key: <ADMIN_API_KEY>
```

**查询参数**:
```typescript
{
  // 分页
  "page": number,                      // 可选,页码,默认1
  "limit": number,                     // 可选,每页数量,1-100,默认20

  // 状态筛选
  "status": string,                    // 可选,枚举:"TRIAL"|"ACTIVE"|"EXPIRED"|"SUSPENDED"|"CANCELLED"

  // ID搜索
  "orgId": string,                     // 可选,组织ID精确匹配
  "payerId": string,                   // 可选,付款人ID精确匹配

  // 支付方式筛选
  "paymentProvider": string,           // 可选,枚举:"stripe"|"paypal"|"none"(none表示未绑定)
  "autoRenew": boolean,                // 可选,是否自动续费:true|false

  // 时间范围筛选
  "createdFrom": string,               // 可选,创建时间起始(ISO 8601)
  "createdTo": string,                 // 可选,创建时间结束(ISO 8601)
  "renewsFrom": string,                // 可选,续费时间起始(ISO 8601)
  "renewsTo": string,                  // 可选,续费时间结束(ISO 8601)
  "trialEndsFrom": string,             // 可选,试用结束时间起始(ISO 8601)
  "trialEndsTo": string,               // 可选,试用结束时间结束(ISO 8601)

  // 价格范围筛选
  "priceMin": number,                  // 可选,最低价格(standardPrice)
  "priceMax": number,                  // 可选,最高价格(standardPrice)

  // 排序
  "sortBy": string,                    // 可选,枚举:"createdAt"|"renewsAt"|"standardPrice"|"status"|"trialEndsAt",默认"createdAt"
  "order": string                      // 可选,枚举:"asc"|"desc",默认"desc"
}
```

**请求示例**:
```
GET /api/subscription-service/v1/admin/subscriptions/list
GET /api/subscription-service/v1/admin/subscriptions/list?page=1&limit=20&status=ACTIVE&sortBy=createdAt&order=desc
GET /api/subscription-service/v1/admin/subscriptions/list?status=TRIAL&trialEndsFrom=2025-10-01T00:00:00Z&trialEndsTo=2025-10-31T23:59:59Z
GET /api/subscription-service/v1/admin/subscriptions/list?paymentProvider=stripe&autoRenew=true&priceMin=100&priceMax=500
```

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "orgId": "org-123",
        "payerId": "user-456",
        "status": "ACTIVE",
        "billingCycle": "monthly",
        "standardPrice": 199.00,
        "autoRenew": true,
        "startedAt": "2025-09-01T00:00:00.000Z",
        "renewsAt": "2025-11-01T00:00:00.000Z",
        "trialEndsAt": null,
        "gracePeriodEndsAt": null,
        "cancelledAt": null,
        "createdAt": "2025-08-25T10:30:00.000Z",
        "updatedAt": "2025-10-18T12:00:00.000Z",
        "paymentProvider": "stripe",
        "paymentLast4": "4242",
        "trialSms": {
          "used": 0,
          "quota": 100,
          "enabled": false
        },
        "smsBudget": {
          "monthlyBudget": 50.00,
          "currentSpending": 12.50,
          "percentage": 25.00,
          "alerts": ["50"]
        },
        "modules": {
          "total": 3,
          "active": 3,
          "topModules": ["appointment", "member", "notification"]
        },
        "extraResources": {
          "total": 5,
          "byType": {
            "pos": 2,
            "tablet": 1,
            "staff": 2
          }
        },
        "currentMonthUsage": {
          "totalAmount": 45.80,
          "smsCount": 152,
          "unbilledAmount": 12.30
        },
        "lastInvoice": {
          "id": "invoice-uuid",
          "number": "INV-2025-10-001",
          "total": 199.00,
          "status": "PAID",
          "createdAt": "2025-10-01T00:00:00.000Z"
        },
        "cancellation": null
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 120,
      "totalPages": 6
    },
    "summary": {
      "totalStandardPrice": 3980.00,
      "averageStandardPrice": 199.00
    }
  },
  "message": "查询成功"
}
```

**数据字段说明**:
- **基本信息**:
  - `id`: 订阅UUID
  - `orgId`: 组织ID
  - `payerId`: 付款人ID
  - `status`: 订阅状态
  - `billingCycle`: 计费周期
  - `standardPrice`: Standard Plan价格
  - `autoRenew`: 是否自动续费

- **时间信息**:
  - `startedAt`: 订阅开始时间
  - `renewsAt`: 下次续费时间
  - `trialEndsAt`: 试用期结束时间
  - `gracePeriodEndsAt`: 宽限期结束时间
  - `cancelledAt`: 取消时间
  - `createdAt`: 创建时间
  - `updatedAt`: 更新时间

- **支付信息**:
  - `paymentProvider`: 支付提供商
  - `paymentLast4`: 支付方式后4位

- **trialSms**: 试用短信使用情况
  - `used`: 已用数量
  - `quota`: 配额（从当前ACTIVE的StandardPlan获取）
  - `enabled`: 是否启用

- **smsBudget**: 短信预算
  - `monthlyBudget`: 月预算
  - `currentSpending`: 当前花费
  - `percentage`: 当前花费占预算百分比
  - `alerts`: 已触发的警告阈值

- **modules**: 包含的模块摘要
  - `total`: 总模块数
  - `active`: 激活的模块数
  - `topModules`: 前3个模块的key

- **extraResources**: 额外资源摘要
  - `total`: 总额外资源数量
  - `byType`: 按资源类型分组

- **currentMonthUsage**: 使用量摘要（本月）
  - `totalAmount`: 本月总使用金额
  - `smsCount`: 本月短信发送数量
  - `unbilledAmount`: 未结算金额

- **lastInvoice**: 最近发票状态
- **cancellation**: 取消信息（如果已取消）

- **summary**: 当前页摘要
  - `totalStandardPrice`: 当前页所有订阅的standardPrice总和
  - `averageStandardPrice`: 当前页平均订阅价格

**错误响应**:
- 401 `MISSING_API_KEY` - 缺少Admin API Key
- 403 `INVALID_API_KEY` - 无效的Admin API Key
- 400 `VALIDATION_ERROR` - 请求参数验证失败
- 400 `INVALID_DATE_RANGE` - 日期范围无效
- 400 `INVALID_PRICE_RANGE` - 价格范围无效（最低价格大于最高价格）
- 500 `INTERNAL_SERVER_ERROR` - 服务器内部错误

---

## Part 2: 订阅管理API (Subscription Management APIs)

### 概述

订阅管理API为前端用户提供完整的订阅生命周期管理功能。

**调用者**: 前端用户
**鉴权方式**: JWT Token (`Authorization: Bearer <token>`)
**用户类型限制**: 仅允许 `userType === "USER"`，ACCOUNT类型（Owner/Manager/Staff）不能调用这些API

**基础路径**: `/api/subscription-service/v1/subscriptions`

---

### 核心特性

1. **双场景激活**: 支持Trial转正式订阅 + 跳过Trial直接订阅
2. **Billing Anchor Day**: 智能处理月份天数差异（参考Stripe标准做法）
3. **按天计费**: 添加模块/资源时精确计算剩余天数费用
4. **月底生效**: 取消/移除操作不立即生效，用户体验更好
5. **完全恢复**: 重新激活时恢复所有之前的配置和价格
6. **枚举化取消原因**: 8种常见原因 + OTHER可选填
7. **宽限期机制**: 释放资源时30天选择期

---

### API列表

| 序号 | 方法 | 端点 | 功能 |
|------|------|------|------|
| 1 | POST | `/trial` | 创建Trial订阅 |
| 2 | POST | `/activate` | 激活订阅（Trial转正式 OR 跳过Trial） |
| 3 | POST | `/modules` | 添加可选模块 |
| 4 | DELETE | `/modules/:moduleKey` | 移除模块（月底生效） |
| 5 | POST | `/resources` | 购买额外资源 |
| 6 | DELETE | `/resources/:resourceType` | 释放资源 |
| 7 | POST | `/downgrade` | 批量减配资源 |
| 8 | POST | `/cancel` | 取消订阅（月底生效，不退款） |
| 9 | POST | `/reactivate` | 重新激活订阅 |
| 10 | PUT | `/payment-method` | 更新支付方式 |
| 11 | PUT | `/sms-budget` | 更新短信预算 |

---

### 1. 创建Trial订阅

**端点**: `POST /api/subscription-service/v1/subscriptions/trial`

**描述**: 创建30天免费Trial订阅

**请求头**:
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**JWT要求**:
- `userType` 必须为 `"USER"`
- 从JWT中提取 `orgId` 和 `userId`（作为payerId）

**请求体**: 无需body参数

**成功响应** (201 Created):
```json
{
  "success": true,
  "data": {
    "subscription": {
      "id": "uuid",
      "orgId": "org-123",
      "status": "TRIAL",
      "startedAt": "2025-01-19T10:00:00Z",
      "trialEndsAt": "2025-02-18T10:00:00Z",
      "renewsAt": null,
      "billingCycle": "monthly",
      "autoRenew": true,
      "standardPrice": 199.00,
      "trialSmsEnabled": true,
      "trialSmsUsed": 0,
      "smsMonthlyBudget": null,
      "smsCurrentSpending": 0,
      "smsBudgetAlerts": [],
      "smsNotifyByEmail": true,
      "smsNotifyBySms": false,
      "createdAt": "2025-01-19T10:00:00Z",
      "updatedAt": "2025-01-19T10:00:00Z"
    },
    "includedModules": [
      {
        "moduleId": "uuid1",
        "key": "appointment",
        "name": "Appointment Management",
        "isActive": true,
        "addedAt": "2025-01-19T10:00:00Z"
      }
    ],
    "resourceQuotas": {
      "pos": 1,
      "kiosk": 0,
      "tablet": 0,
      "manager": 1,
      "staff": 3
    },
    "trialInfo": {
      "durationDays": 30,
      "remainingDays": 30,
      "expiresAt": "2025-02-18T10:00:00Z",
      "smsQuota": 100,
      "smsRemaining": 100
    }
  },
  "message": "Trial subscription created successfully"
}
```

**错误响应**:
| 状态码 | 错误代码 | 说明 |
|--------|----------|------|
| 400 | SUBSCRIPTION_ALREADY_EXISTS | 组织已存在订阅 |
| 403 | INVALID_USER_TYPE | 用户类型不是USER |
| 404 | STANDARD_PLAN_NOT_FOUND | 无ACTIVE StandardPlan |
| 401 | UNAUTHORIZED | JWT无效 |

---

### 2. 激活订阅

**端点**: `POST /api/subscription-service/v1/subscriptions/activate`

**描述**: 激活订阅，支持两种场景：
- **场景A (skipTrial=false)**: Trial转正式订阅
- **场景B (skipTrial=true)**: 跳过Trial直接订阅

**请求头**:
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**请求体**:
```json
{
  "paymentProvider": "stripe",
  "paymentMethodId": "pm_xxxxx",
  "skipTrial": false
}
```

**参数说明**:
- `paymentProvider`: 支付方式 (`stripe` | `paypal`)
- `paymentMethodId`: Stripe Payment Method ID
- `skipTrial`:
  - `false` (默认): Trial转正式订阅
  - `true`: 跳过Trial直接订阅

**成功响应 - 场景A (Trial转正式)** (200 OK):
```json
{
  "success": true,
  "data": {
    "subscription": {
      "id": "uuid",
      "status": "ACTIVE",
      "renewsAt": "2025-02-19T10:00:00Z",
      "paymentProvider": "stripe",
      "paymentLast4": "4242"
    },
    "invoice": {
      "id": "uuid",
      "number": "INV-2025-01-001",
      "periodStart": "2025-02-19T00:00:00Z",
      "periodEnd": "2025-03-19T00:00:00Z",
      "total": 224.87,
      "status": "PENDING",
      "dueDate": "2025-02-19T10:00:00Z"
    },
    "activationType": "TRIAL_CONVERSION",
    "billingInfo": {
      "firstChargeDate": "2025-02-19T10:00:00Z",
      "firstChargeDateDescription": "You will be charged on Feb 19, 2025 (after trial ends)",
      "recurringCharge": 199.00,
      "nextBillingDate": "2025-03-19T00:00:00Z"
    }
  },
  "message": "Trial subscription activated successfully. First charge on Feb 19, 2025."
}
```

**关键说明 - Billing Anchor Day**:
```
1月31日订阅 → 2月续费: 2月28日（2月没有31日，使用最后一天）
1月31日订阅 → 3月续费: 3月31日（3月有31日，恢复到31日）
参考Stripe的Billing Anchor Day机制
```

**错误响应**:
| 状态码 | 错误代码 | 说明 |
|--------|----------|------|
| 404 | SUBSCRIPTION_NOT_FOUND | skipTrial=false但没有Trial订阅 |
| 400 | TRIAL_ALREADY_EXISTS | skipTrial=true但已有Trial订阅 |
| 400 | INVALID_PAYMENT_METHOD | 支付方式无效 |
| 402 | PAYMENT_FAILED | 扣款失败（仅skipTrial=true） |

---

### 3. 添加可选模块

**端点**: `POST /api/subscription-service/v1/subscriptions/modules`

**描述**: 添加Standard Plan不包含的可选模块

**请求头**:
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**请求体**:
```json
{
  "moduleKey": "marketing"
}
```

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "module": {
      "moduleId": "uuid",
      "key": "marketing",
      "name": "Marketing Tools",
      "monthlyPrice": 50.00,
      "isActive": true,
      "addedAt": "2025-01-25T10:00:00Z"
    },
    "proratedCharge": {
      "daysRemaining": 25,
      "dailyRate": 1.67,
      "amount": 41.75,
      "description": "Prorated charge for 25 days"
    },
    "nextInvoice": {
      "periodEnd": "2025-02-19T10:00:00Z",
      "estimatedAmount": 249.00
    }
  },
  "message": "Module added successfully"
}
```

**错误响应**:
| 状态码 | 错误代码 | 说明 |
|--------|----------|------|
| 404 | MODULE_NOT_FOUND | 模块不存在或已废弃 |
| 400 | MODULE_ALREADY_ADDED | 模块已添加 |

---

### 4. 移除模块

**端点**: `DELETE /api/subscription-service/v1/subscriptions/modules/:moduleKey`

**描述**: 移除可选模块（月底生效，不退款）

**请求头**:
```
Authorization: Bearer <jwt_token>
```

**路径参数**:
- `moduleKey`: 模块标识

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "module": {
      "moduleId": "uuid",
      "key": "marketing",
      "name": "Marketing Tools",
      "isActive": false,
      "removedAt": "2025-02-19T00:00:00Z"
    },
    "effectiveDate": "2025-02-19T00:00:00Z",
    "refund": null,
    "message": "Module will be removed at the end of current billing period"
  },
  "message": "Module removal scheduled successfully"
}
```

---

### 5. 购买额外资源

**端点**: `POST /api/subscription-service/v1/subscriptions/resources`

**描述**: 购买超出Standard Plan标准配额的额外资源

**请求头**:
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**请求体**:
```json
{
  "resourceType": "staff",
  "quantity": 2
}
```

**支持的资源类型**:
| 资源类型 | 说明 | 单价（月） |
|---------|------|-----------|
| `pos` | POS终端 | $5.00/个 |
| `kiosk` | Kiosk自助终端 | $8.00/个 |
| `tablet` | 平板设备 | $6.00/个 |
| `manager` | Manager账户 | $15.00/个 |
| `staff` | Staff账户 | $10.00/个 |

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "resource": {
      "resourceType": "staff",
      "quantityAdded": 2,
      "newTotal": 5,
      "unitPrice": 10.00,
      "monthlyPrice": 20.00
    },
    "proratedCharge": {
      "daysRemaining": 25,
      "dailyRate": 0.67,
      "amount": 16.75,
      "description": "Prorated charge for 25 days (2 staff × $0.33/day × 25 days)"
    },
    "immediateCharge": {
      "amount": 16.75,
      "currency": "USD",
      "chargeDate": "2025-01-25T10:00:00Z",
      "paymentMethod": "Stripe (****4242)"
    },
    "quotaUpdate": {
      "before": {"staff": 3},
      "after": {"staff": 5},
      "increase": 2
    }
  },
  "message": "Resource purchased successfully. Charged $16.75 for prorated usage."
}
```

**计费逻辑**:
```
1. 计算剩余天数: days = (renewsAt - now) / 1天
2. 计算日费率: dailyRate = (unitPrice / 30天)
3. 计算按天费用: proratedCharge = quantity × dailyRate × days
4. 立即扣款: 通过Stripe扣除proratedCharge
```

**错误响应**:
| 状态码 | 错误代码 | 说明 |
|--------|----------|------|
| 404 | RESOURCE_NOT_FOUND | 资源类型不存在 |
| 400 | INVALID_QUANTITY | quantity必须>0 |
| 402 | PAYMENT_FAILED | 支付失败 |

---

### 6. 释放资源

**端点**: `DELETE /api/subscription-service/v1/subscriptions/resources/:resourceType`

**描述**: 释放额外购买的资源（30天宽限期）

**请求头**:
```
Authorization: Bearer <jwt_token>
```

**路径参数**:
- `resourceType`: 资源类型（pos/kiosk/tablet/manager/staff）

**Query参数**:
```
quantity=2
```

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "resource": {
      "resourceType": "staff",
      "quantityReleased": 2,
      "newTotal": 3,
      "unitPrice": 10.00,
      "monthlySavings": 20.00
    },
    "gracePeriod": {
      "daysRemaining": 30,
      "endsAt": "2025-02-24T10:00:00Z",
      "description": "You have 30 days to re-purchase without re-paying setup if needed"
    },
    "billingImpact": {
      "noRefund": true,
      "refundMessage": "No refund. Reduction will take effect at next renewal.",
      "nextRenewalDate": "2025-02-19T10:00:00Z",
      "nextRenewalAmount": 239.00,
      "savingsPerMonth": 20.00
    },
    "quotaUpdate": {
      "before": {"staff": 5},
      "after": {"staff": 3},
      "decrease": 2
    }
  },
  "message": "Resource released successfully. Savings will apply at next renewal."
}
```

**宽限期机制**:
```
1. 释放后30天内可免费重新购买（不收安装费）
2. 超过30天后重新购买需重新按天计费
3. 释放不退款，下次续费生效
```

**错误响应**:
| 状态码 | 错误代码 | 说明 |
|--------|----------|------|
| 400 | INSUFFICIENT_RESOURCES | 释放量超过当前持有量 |
| 400 | CANNOT_RELEASE_STANDARD | 不能释放Standard Plan标准配额 |

---

### 7. 批量减配资源

**端点**: `POST /api/subscription-service/v1/subscriptions/downgrade`

**描述**: 一次性减配多种资源（下次续费生效，不退款）

**请求头**:
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**请求体**:
```json
{
  "resources": {
    "pos": 1,
    "staff": 3
  }
}
```

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "downgrades": [
      {
        "resourceType": "pos",
        "before": 2,
        "after": 1,
        "decrease": 1,
        "unitPrice": 5.00,
        "monthlySavings": 5.00
      },
      {
        "resourceType": "staff",
        "before": 5,
        "after": 3,
        "decrease": 2,
        "unitPrice": 10.00,
        "monthlySavings": 20.00
      }
    ],
    "totalSavings": {
      "perMonth": 25.00,
      "effectiveDate": "2025-02-19T10:00:00Z",
      "currentMonthlyTotal": 259.00,
      "newMonthlyTotal": 234.00
    },
    "billingImpact": {
      "noRefund": true,
      "refundMessage": "No refund. Reductions will take effect at next renewal.",
      "nextRenewalDate": "2025-02-19T10:00:00Z",
      "nextRenewalAmount": 234.00
    }
  },
  "message": "Resources downgraded successfully. Savings of $25.00/month starting Feb 19, 2025."
}
```

**关键规则**:
- ❌ 不立即生效：下次续费时才减配
- ❌ 不退款：当月已付费用不退还
- ✅ 继续使用：减配前可继续使用当前配额到月底
- ✅ 批量操作：一次调整多个资源类型

**错误响应**:
| 状态码 | 错误代码 | 说明 |
|--------|----------|------|
| 400 | EMPTY_DOWNGRADE | resources对象为空 |
| 400 | INVALID_QUANTITY | 目标数量无效（小于0或超过当前） |

---

### 8. 取消订阅

**端点**: `POST /api/subscription-service/v1/subscriptions/cancel`

**描述**: 取消订阅（月底生效，不退款）

**请求头**:
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**请求体**:
```json
{
  "reason": "TOO_EXPENSIVE",
  "otherReason": ""
}
```

**取消原因枚举**:
| 原因代码 | 显示文本 |
|---------|---------|
| TOO_EXPENSIVE | Too expensive |
| MISSING_FEATURES | Missing features |
| SWITCHING_COMPETITOR | Switching to competitor |
| BUSINESS_CLOSED | Business closed |
| TECHNICAL_ISSUES | Technical issues |
| POOR_SUPPORT | Poor customer support |
| NOT_USING | Not using the service |
| OTHER | Other reason (可选填otherReason) |

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "subscription": {
      "id": "uuid",
      "status": "ACTIVE",
      "cancelledAt": "2025-01-25T10:00:00Z",
      "cancelReason": "TOO_EXPENSIVE",
      "cancelReasonDisplay": "Too expensive",
      "otherReason": null,
      "effectiveDate": "2025-02-19T00:00:00Z",
      "renewsAt": "2025-02-19T00:00:00Z"
    },
    "accessInfo": {
      "remainingDays": 25,
      "accessUntil": "2025-02-19T00:00:00Z",
      "fullAccessMessage": "You will have full access to all features until Feb 19, 2025"
    },
    "refundInfo": {
      "refundAmount": 0,
      "refundMessage": "No refund. Subscription will remain active until the end of current billing period."
    }
  },
  "message": "Subscription cancelled successfully. Access until Feb 19, 2025."
}
```

**关键规则**:
- ❌ 不立即生效：status保持ACTIVE到月底
- ❌ 不退款：refundAmount始终为0
- ✅ 完整使用权：用户继续使用到月底
- ✅ 自动过期：到renewsAt时，Webhook通知，更新status=CANCELLED

---

### 9. 重新激活订阅

**端点**: `POST /api/subscription-service/v1/subscriptions/reactivate`

**描述**: 重新激活已取消的订阅，完全恢复之前的配置和价格

**请求头**:
```
Authorization: Bearer <jwt_token>
```

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "subscription": {
      "id": "uuid",
      "status": "ACTIVE",
      "cancelledAt": null,
      "cancelReason": null,
      "renewsAt": "2025-02-19T10:00:00Z",
      "autoRenew": true
    },
    "restoredConfiguration": {
      "modules": [
        {"key": "appointment", "name": "Appointment Management"},
        {"key": "marketing", "name": "Marketing Tools"}
      ],
      "resources": {
        "pos": 2,
        "staff": 5
      },
      "monthlyPrice": 259.00,
      "breakdown": {
        "standardPlan": 199.00,
        "modules": {"marketing": 50.00},
        "resources": {"pos": 5.00, "staff": 20.00}
      }
    }
  },
  "message": "Subscription reactivated successfully. All previous configurations restored."
}
```

**关键点**:
- ✅ 完全恢复：所有模块、资源、价格与取消前一致
- ✅ 无需重新配置：用户不需要重新添加模块或购买资源

**错误响应**:
| 状态码 | 错误代码 | 说明 |
|--------|----------|------|
| 400 | NOT_CANCELLED | 订阅未取消，无需激活 |
| 400 | ALREADY_EXPIRED | 订阅已过期，无法重新激活 |

---

### 10. 更新支付方式

**端点**: `PUT /api/subscription-service/v1/subscriptions/payment-method`

**描述**: 更新订阅的支付方式（仅限Stripe Payment Method）

**请求头**:
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**请求体**:
```json
{
  "paymentProvider": "stripe",
  "paymentMethodId": "pm_new12345"
}
```

**参数说明**:
- `paymentProvider`: 当前仅支持 `"stripe"`
- `paymentMethodId`: 新的Stripe Payment Method ID

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "paymentMethod": {
      "provider": "stripe",
      "last4": "5678",
      "brand": "visa",
      "expiryMonth": 12,
      "expiryYear": 2027,
      "isDefault": true
    },
    "updated": {
      "updatedAt": "2025-01-25T10:00:00Z",
      "updatedBy": "user-456"
    },
    "nextCharge": {
      "date": "2025-02-19T00:00:00Z",
      "amount": 259.00,
      "paymentMethod": "Visa ending in 5678"
    }
  },
  "message": "Payment method updated successfully. Next charge on Feb 19, 2025."
}
```

**业务逻辑**:
```
1. 验证新paymentMethodId有效性（调用Stripe API）
2. 更新Subscription表的paymentMethodId字段
3. 提取卡片信息（last4, brand, expiry）
4. 下次续费自动使用新支付方式
```

**错误响应**:
| 状态码 | 错误代码 | 说明 |
|--------|----------|------|
| 400 | INVALID_PAYMENT_METHOD | Payment Method ID无效 |
| 400 | PAYMENT_METHOD_REJECTED | 支付方式被拒绝 |
| 403 | TRIAL_NO_PAYMENT | Trial订阅无需支付方式 |

---

### 11. 更新短信预算

**端点**: `PUT /api/subscription-service/v1/subscriptions/sms-budget`

**描述**: 更新月度短信预算和通知设置

**请求头**:
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**请求体**:
```json
{
  "smsMonthlyBudget": 500.00,
  "smsBudgetAlerts": [
    {"threshold": 50, "triggered": false},
    {"threshold": 75, "triggered": false},
    {"threshold": 90, "triggered": false}
  ],
  "smsNotifyByEmail": true,
  "smsNotifyBySms": false
}
```

**参数说明**:
- `smsMonthlyBudget`: 月度预算金额（USD），`null`表示无限制，`>0`表示设置预算
- `smsBudgetAlerts`: 预算告警阈值数组
  - `threshold`: 百分比阈值（0-100）
  - `triggered`: 是否已触发（更新时设为false重置）
- `smsNotifyByEmail`: 是否通过Email通知
- `smsNotifyBySms`: 是否通过SMS通知

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "smsBudget": {
      "monthlyBudget": 500.00,
      "currentSpending": 127.35,
      "remainingBudget": 372.65,
      "usagePercentage": 25.47,
      "alerts": [
        {"threshold": 50, "triggered": false, "amount": 250.00},
        {"threshold": 75, "triggered": false, "amount": 375.00},
        {"threshold": 90, "triggered": false, "amount": 450.00}
      ]
    },
    "notifications": {
      "notifyByEmail": true,
      "notifyBySms": false,
      "email": "admin@example.com",
      "phone": null
    },
    "renewalInfo": {
      "nextResetDate": "2025-02-19T00:00:00Z",
      "description": "Budget and spending will reset on next renewal"
    }
  },
  "message": "SMS budget updated successfully"
}
```

**告警触发机制**:
```
1. 每次短信消费后，计算 usagePercentage = (currentSpending / monthlyBudget) × 100
2. 检查是否超过任何未触发的阈值
3. 如果超过：
   - 将该阈值的triggered设为true
   - 发送通知（Email/SMS根据配置）
   - 阻止重复通知（同一阈值每月只触发一次）
4. 月底续费时重置：currentSpending=0, 所有triggered=false
```

**特殊场景**:
| 场景 | 行为 |
|------|------|
| `smsMonthlyBudget = null` | 无预算限制，不触发告警 |
| `smsBudgetAlerts = []` | 有预算但不设告警 |
| 超预算 | 仅通知，不阻止继续发送短信 |

**错误响应**:
| 状态码 | 错误代码 | 说明 |
|--------|----------|------|
| 400 | INVALID_BUDGET | 预算金额无效（必须>0或null） |
| 400 | INVALID_THRESHOLD | 阈值必须在0-100之间 |

---

### Part 2 通用错误代码

| 错误代码 | HTTP状态码 | 说明 |
|---------|-----------|------|
| UNAUTHORIZED | 401 | JWT Token无效或缺失 |
| INVALID_USER_TYPE | 403 | 用户类型不是USER |
| SUBSCRIPTION_NOT_FOUND | 404 | 订阅不存在 |
| SUBSCRIPTION_ALREADY_EXISTS | 400 | 订阅已存在 |
| INVALID_STATUS | 400 | 订阅状态不符合操作要求 |
| STANDARD_PLAN_NOT_FOUND | 404 | 无ACTIVE StandardPlan |
| MODULE_NOT_FOUND | 404 | 模块不存在 |
| MODULE_ALREADY_ADDED | 400 | 模块已添加 |
| RESOURCE_NOT_FOUND | 404 | 资源不存在 |
| PAYMENT_PROVIDER_ERROR | 500 | 支付提供商错误 |
| INTERNAL_SERVER_ERROR | 500 | 服务器内部错误 |

---

## Part 3: 查询API (Query APIs)

### 概述

查询API为前端用户提供订阅、账单、使用量等数据的只读访问。

**调用者**: 前端用户
**鉴权方式**: JWT Token (`Authorization: Bearer <token>`)
**用户类型限制**: 仅允许 `userType === "USER"`
**基础路径**: `/api/subscription-service/v1/queries`

**特点**:
- 完全只读，不修改任何数据
- 支持分页、筛选、排序
- 实时计算配额使用率和费用统计
- 权限隔离：用户只能查询自己组织的数据

---

### API列表

| 序号 | 方法 | 端点 | 功能 |
|------|------|------|------|
| 1 | GET | `/subscription` | 查询当前订阅详情 |
| 2 | GET | `/invoices` | 查询账单历史 |
| 3 | GET | `/invoices/:invoiceId` | 查询单个发票详情 |
| 4 | GET | `/usage` | 查询使用量明细 |
| 5 | GET | `/usage/summary` | 查询使用量统计 |
| 6 | GET | `/preview-activation` | 预览激活后费用 |
| 7 | GET | `/quotas` | 查询可用配额 |
| 8 | GET | `/logs` | 查询订阅日志 |

---

### 1. 查询当前订阅详情

**端点**: `GET /api/subscription-service/v1/queries/subscription`

**描述**: 查询当前组织的订阅详情，包含模块、资源、短信预算、计费信息等

**请求头**:
```
Authorization: Bearer <jwt_token>
```

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "subscription": {
      "id": "uuid",
      "orgId": "org-123",
      "payerId": "user-456",
      "status": "ACTIVE",
      "billingCycle": "monthly",
      "startedAt": "2025-01-19T10:00:00Z",
      "renewsAt": "2025-02-19T10:00:00Z",
      "trialEndsAt": null,
      "autoRenew": true,
      "standardPrice": 199.00,
      "cancelledAt": null,
      "cancelReason": null,
      "paymentProvider": "stripe",
      "paymentLast4": "4242",
      "createdAt": "2025-01-19T10:00:00Z",
      "updatedAt": "2025-01-19T10:00:00Z"
    },
    "modules": {
      "included": [
        {
          "moduleId": "uuid1",
          "key": "appointment",
          "name": "Appointment Management",
          "category": "business",
          "isActive": true,
          "addedAt": "2025-01-19T10:00:00Z",
          "removedAt": null
        }
      ],
      "optional": [
        {
          "moduleId": "uuid2",
          "key": "marketing",
          "name": "Marketing Tools",
          "category": "marketing",
          "monthlyPrice": 50.00,
          "isActive": true,
          "addedAt": "2025-01-25T10:00:00Z",
          "removedAt": null
        }
      ]
    },
    "resources": [
      {
        "type": "pos",
        "base": 1,
        "extra": 1,
        "total": 2
      },
      {
        "type": "staff",
        "base": 3,
        "extra": 2,
        "total": 5
      }
    ],
    "sms": {
      "trialSmsUsed": 0,
      "trialSmsEnabled": false,
      "monthlyBudget": 100.00,
      "currentSpending": 23.50,
      "budgetAlerts": [50, 80, 95],
      "notifyByEmail": true,
      "notifyBySms": false
    },
    "billing": {
      "monthlyTotal": 269.00,
      "breakdown": {
        "standardPlan": 199.00,
        "modules": {
          "marketing": 50.00
        },
        "resources": {
          "pos": {
            "quantity": 1,
            "unitPrice": 10.00,
            "total": 10.00
          },
          "staff": {
            "quantity": 2,
            "unitPrice": 5.00,
            "total": 10.00
          }
        }
      },
      "nextBillingDate": "2025-02-19T10:00:00Z",
      "paymentProvider": "stripe",
      "paymentLast4": "4242"
    }
  }
}
```

**Trial订阅额外字段**:
```json
{
  "trial": {
    "endsAt": "2025-02-18T10:00:00Z",
    "remainingDays": 25
  }
}
```

**已取消订阅额外字段**:
```json
{
  "cancellation": {
    "cancelledAt": "2025-01-25T10:00:00Z",
    "reason": "TOO_EXPENSIVE",
    "effectiveDate": "2025-02-19T10:00:00Z",
    "remainingDays": 25
  }
}
```

---

### 2. 查询账单历史

**端点**: `GET /api/subscription-service/v1/queries/invoices`

**描述**: 查询账单历史，支持分页和筛选

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | number | 否 | 页码（默认1） |
| pageSize | number | 否 | 每页数量（默认20，最大100） |
| status | string | 否 | 发票状态：PENDING/PAID/FAILED/REFUNDED |
| from | string | 否 | 开始日期（ISO 8601格式） |
| to | string | 否 | 结束日期（ISO 8601格式） |

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "invoices": [
      {
        "id": "uuid",
        "number": "INV-2025-01-001",
        "periodStart": "2025-01-19T00:00:00Z",
        "periodEnd": "2025-02-19T00:00:00Z",
        "items": {...},
        "itemsSummary": {
          "itemCount": 5,
          "categories": ["subscription", "modules", "resources", "usage"]
        },
        "subtotal": 269.00,
        "discount": 0,
        "tax": 34.97,
        "total": 303.97,
        "status": "PAID",
        "paidAt": "2025-01-19T10:05:00Z",
        "paymentProvider": "stripe",
        "failureReason": null,
        "pdfUrl": "https://...",
        "createdAt": "2025-01-19T10:00:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 3,
      "totalPages": 1
    }
  }
}
```

---

### 3. 查询单个发票详情

**端点**: `GET /api/subscription-service/v1/queries/invoices/:invoiceId`

**描述**: 查询单个发票的完整详情，包含所有明细项和使用量记录

**路径参数**:
- `invoiceId`: 发票ID（UUID格式）

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "invoice": {
      "id": "uuid",
      "number": "INV-2025-01-001",
      "periodStart": "2025-01-19T00:00:00Z",
      "periodEnd": "2025-02-19T00:00:00Z",
      "itemsDetailed": {
        "subscription": {
          "description": "Standard Plan",
          "amount": 199.00
        },
        "modules": [
          {
            "key": "marketing",
            "name": "Marketing Tools",
            "amount": 50.00
          }
        ],
        "resources": [
          {
            "type": "pos",
            "quantity": 1,
            "unitPrice": 10.00,
            "amount": 10.00
          }
        ],
        "usage": {
          "sms": {
            "quantity": 235,
            "unitPrice": 0.10,
            "amount": 23.50
          }
        }
      },
      "subtotal": 282.50,
      "discount": 0,
      "tax": 36.73,
      "total": 319.23,
      "status": "PAID",
      "paidAt": "2025-01-19T10:05:00Z",
      "paymentProvider": "stripe",
      "providerInvoiceId": "in_xxxxx",
      "pdfUrl": "https://...",
      "createdAt": "2025-01-19T10:00:00Z",
      "updatedAt": "2025-01-19T10:05:00Z"
    },
    "usages": [
      {
        "id": "uuid",
        "usageType": "sms",
        "quantity": 235,
        "unitPrice": 0.10,
        "amount": 23.50,
        "isFree": false,
        "metadata": {...},
        "createdAt": "2025-01-19T15:00:00Z"
      }
    ]
  }
}
```

---

### 4. 查询使用量明细

**端点**: `GET /api/subscription-service/v1/queries/usage`

**描述**: 查询使用量记录，支持分页和多维度筛选

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | number | 否 | 页码（默认1） |
| pageSize | number | 否 | 每页数量（默认20，最大100） |
| usageType | string | 否 | 使用类型：sms, api_call |
| moduleId | string | 否 | 模块ID（UUID格式） |
| from | string | 否 | 开始日期（ISO 8601格式） |
| to | string | 否 | 结束日期（ISO 8601格式） |
| isFree | boolean | 否 | 是否免费：true/false |

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "usages": [
      {
        "id": "uuid",
        "usageType": "sms",
        "quantity": 10,
        "unitPrice": 0.10,
        "amount": 1.00,
        "isFree": false,
        "metadata": {
          "to": "+1234567890",
          "status": "delivered"
        },
        "module": {
          "key": "notification",
          "name": "Notification System"
        },
        "billedAt": "2025-02-01T00:00:00Z",
        "invoiceId": "uuid",
        "createdAt": "2025-01-25T14:30:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 150,
      "totalPages": 8
    }
  }
}
```

---

### 5. 查询使用量统计

**端点**: `GET /api/subscription-service/v1/queries/usage/summary`

**描述**: 查询使用量统计汇总，按usageType分组

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| from | string | 否 | 开始日期（默认当前计费周期开始） |
| to | string | 否 | 结束日期（默认当前计费周期结束） |

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "period": {
      "start": "2025-01-19T00:00:00Z",
      "end": "2025-02-19T00:00:00Z"
    },
    "summary": [
      {
        "usageType": "sms",
        "free": {
          "quantity": 50,
          "count": 5,
          "amount": 0
        },
        "paid": {
          "quantity": 235,
          "count": 24,
          "amount": 23.50
        },
        "total": {
          "quantity": 285,
          "count": 29,
          "amount": 23.50
        }
      },
      {
        "usageType": "api_call",
        "free": {
          "quantity": 1000,
          "count": 100,
          "amount": 0
        },
        "paid": {
          "quantity": 0,
          "count": 0,
          "amount": 0
        },
        "total": {
          "quantity": 1000,
          "count": 100,
          "amount": 0
        }
      }
    ],
    "totals": {
      "free": 0,
      "paid": 23.50,
      "total": 23.50
    }
  }
}
```

---

### 6. 预览激活后费用

**端点**: `GET /api/subscription-service/v1/queries/preview-activation`

**描述**: 预览Trial转正式后的费用，仅Trial订阅可用

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "preview": {
      "firstChargeDate": "2025-02-18T10:00:00Z",
      "firstChargeAmount": 269.00,
      "recurringMonthlyAmount": 269.00,
      "nextBillingDate": "2025-03-18T10:00:00Z"
    },
    "breakdown": {
      "standardPlan": 199.00,
      "modulesTotal": 50.00,
      "modulesDetails": {
        "marketing": 50.00
      },
      "resourcesTotal": 20.00,
      "resourcesDetails": {
        "pos": {
          "quantity": 1,
          "unitPrice": 10.00,
          "total": 10.00
        },
        "staff": {
          "quantity": 2,
          "unitPrice": 5.00,
          "total": 10.00
        }
      },
      "total": 269.00
    }
  }
}
```

**错误响应**:
| 状态码 | 错误代码 | 说明 |
|--------|----------|------|
| 400 | INVALID_STATUS | 仅Trial订阅可用 |

---

### 7. 查询可用配额

**端点**: `GET /api/subscription-service/v1/queries/quotas`

**描述**: 查询各资源类型的配额和使用情况

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "resources": [
      {
        "type": "pos",
        "baseQuota": 1,
        "extraQuota": 1,
        "totalQuota": 2,
        "currentUsage": 2,
        "available": 0,
        "suspended": 0
      },
      {
        "type": "staff",
        "baseQuota": 3,
        "extraQuota": 2,
        "totalQuota": 5,
        "currentUsage": 4,
        "available": 1,
        "suspended": 1
      }
    ],
    "suspended": [
      {
        "id": "uuid",
        "resourceType": "account",
        "resourceSubtype": "staff",
        "resourceTargetId": "staff-789",
        "suspendedAt": "2025-01-20T10:00:00Z",
        "graceExpiresAt": "2025-02-19T10:00:00Z",
        "reason": "DOWNGRADE",
        "remainingDays": 25
      }
    ],
    "sms": {
      "trialSmsEnabled": false,
      "trialSmsUsed": 0,
      "monthlyBudget": 100.00,
      "currentSpending": 23.50,
      "budgetAlerts": [50, 80, 95]
    }
  }
}
```

**说明**:
- `currentUsage`: 需要从auth-service实时查询（当前实现返回0）
- `suspended`: 暂停的资源列表，处于30天宽限期内

---

### 8. 查询订阅日志

**端点**: `GET /api/subscription-service/v1/queries/logs`

**描述**: 查询订阅操作日志，支持分页和筛选

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | number | 否 | 页码（默认1） |
| pageSize | number | 否 | 每页数量（默认20，最大100） |
| action | string | 否 | 操作类型筛选 |

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "id": "uuid",
        "action": "SUBSCRIPTION_CREATED",
        "actorId": "user-456",
        "details": {
          "subscriptionId": "uuid",
          "status": "TRIAL"
        },
        "createdAt": "2025-01-19T10:00:00Z"
      },
      {
        "id": "uuid",
        "action": "MODULE_ADDED",
        "actorId": "user-456",
        "details": {
          "moduleKey": "marketing",
          "proratedCharge": 41.75
        },
        "createdAt": "2025-01-25T10:00:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 15,
      "totalPages": 1
    }
  }
}
```

---

### Part 3 通用错误代码

| 错误代码 | HTTP状态码 | 说明 |
|---------|-----------|------|
| UNAUTHORIZED | 401 | JWT Token无效或缺失 |
| INVALID_USER_TYPE | 403 | 用户类型不是USER |
| SUBSCRIPTION_NOT_FOUND | 404 | 订阅不存在 |
| INVOICE_NOT_FOUND | 404 | 发票不存在 |
| STANDARD_PLAN_NOT_FOUND | 404 | 无ACTIVE StandardPlan |
| INVALID_STATUS | 400 | 订阅状态不符合操作要求 |
| DATABASE_ERROR | 500 | 数据库查询错误 |
| INTERNAL_SERVER_ERROR | 500 | 服务器内部错误 |

---

## Part 4: 内部API (Internal APIs)

### 概述

内部API为其他微服务提供订阅相关的核心功能，包括配额检查、访问权限验证、使用量记录等。

**调用者**: auth-service、notification-service等微服务
**鉴权方式**: Service API Key (`X-API-Key` header)
**基础路径**: `/api/subscription-service/v1/internal`

**特点**:
- 快速响应（< 100ms）
- 幂等性设计
- 事务保证
- 宽限期机制

---

### API列表

| 序号 | 方法 | 端点 | 功能 | 调用方 |
|------|------|------|------|--------|
| 1 | POST | `/quota/check` | 检查资源配额 | auth-service |
| 2 | POST | `/access/check` | 检查访问权限 | auth-service |
| 3 | POST | `/resources/suspend` | 暂停资源 | subscription-service |
| 4 | POST | `/resources/restore` | 恢复资源 | subscription-service |
| 5 | POST | `/usage/record` | 记录使用量 | notification-service |
| 6 | POST | `/usage/batch` | 批量记录使用量 | notification-service |
| 7 | POST | `/stats/active-resources` | 统计活跃资源 | auth-service |

---

### 1. 检查资源配额

**端点**: `POST /api/subscription-service/v1/internal/quota/check`

**描述**: auth-service在创建设备/账号前调用，检查是否超过配额

**请求头**:
```
X-API-Key: <service_api_key>
Content-Type: application/json
```

**请求体**:
```json
{
  "orgId": "org-123",
  "resourceType": "pos",  // pos | kiosk | tablet | manager | staff
  "quantity": 1           // 可选，默认1
}
```

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "allowed": true,
    "quotaInfo": {
      "total": 5,
      "used": 3,
      "available": 2,
      "suspended": 0
    },
    "subscriptionStatus": "ACTIVE"
  }
}
```

**配额不足响应**:
```json
{
  "success": true,
  "data": {
    "allowed": false,
    "quotaInfo": {
      "total": 5,
      "used": 5,
      "available": 0,
      "suspended": 0
    },
    "subscriptionStatus": "ACTIVE",
    "reason": "Insufficient quota. Available: 0, Requested: 1"
  }
}
```

---

### 2. 检查访问权限

**端点**: `POST /api/subscription-service/v1/internal/access/check`

**描述**: auth-service在设备/账号登录时调用，检查是否被暂停

**请求头**:
```
X-API-Key: <service_api_key>
Content-Type: application/json
```

**请求体**:
```json
{
  "orgId": "org-123",
  "resourceType": "device",     // device | account
  "resourceSubtype": "pos",     // pos/kiosk/tablet | manager/staff
  "resourceId": "device-456"
}
```

**成功响应 - 允许访问** (200 OK):
```json
{
  "success": true,
  "data": {
    "allowed": true,
    "reason": null,
    "suspendedInfo": null,
    "subscriptionStatus": "ACTIVE"
  }
}
```

**成功响应 - 宽限期警告**:
```json
{
  "success": true,
  "data": {
    "allowed": true,
    "reason": null,
    "suspendedInfo": {
      "id": "uuid",
      "suspendedAt": "2025-01-20T10:00:00Z",
      "graceExpiresAt": "2025-02-19T10:00:00Z",
      "reason": "DOWNGRADE",
      "remainingDays": 25,
      "warning": "This resource will be suspended in 25 days"
    },
    "subscriptionStatus": "ACTIVE"
  }
}
```

**成功响应 - 拒绝访问**:
```json
{
  "success": true,
  "data": {
    "allowed": false,
    "reason": "Resource suspended due to DOWNGRADE",
    "suspendedInfo": {
      "id": "uuid",
      "suspendedAt": "2025-01-20T10:00:00Z",
      "graceExpiresAt": "2025-01-21T10:00:00Z",
      "reason": "DOWNGRADE",
      "remainingDays": 0,
      "warning": null
    },
    "subscriptionStatus": "ACTIVE"
  }
}
```

---

### 3. 暂停资源

**端点**: `POST /api/subscription-service/v1/internal/resources/suspend`

**描述**: 暂停设备/账号，设置宽限期

**请求头**:
```
X-API-Key: <service_api_key>
Content-Type: application/json
```

**请求体**:
```json
{
  "orgId": "org-123",
  "resourceType": "device",
  "resourceSubtype": "pos",
  "resourceId": "device-456",
  "reason": "DOWNGRADE",  // DOWNGRADE | PAYMENT_FAILED | MANUAL
  "gracePeriodDays": 30   // 可选，默认30
}
```

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "suspended": {
      "id": "uuid",
      "resourceId": "device-456",
      "suspendedAt": "2025-01-20T10:00:00Z",
      "graceExpiresAt": "2025-02-19T10:00:00Z",
      "reason": "DOWNGRADE",
      "remainingDays": 30
    },
    "alreadySuspended": false
  }
}
```

---

### 4. 恢复资源

**端点**: `POST /api/subscription-service/v1/internal/resources/restore`

**描述**: 取消暂停，恢复访问

**请求头**:
```
X-API-Key: <service_api_key>
Content-Type: application/json
```

**请求体**:
```json
{
  "orgId": "org-123",
  "resourceType": "device",
  "resourceSubtype": "pos",
  "resourceId": "device-456"
}
```

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "restored": true,
    "restoredAt": "2025-01-25T10:00:00Z"
  }
}
```

**未暂停响应**:
```json
{
  "success": true,
  "data": {
    "restored": false,
    "restoredAt": null,
    "reason": "Resource is not suspended"
  }
}
```

---

### 5. 记录使用量

**端点**: `POST /api/subscription-service/v1/internal/usage/record`

**描述**: notification-service发送SMS后调用，记录使用量

**请求头**:
```
X-API-Key: <service_api_key>
Content-Type: application/json
```

**请求体**:
```json
{
  "orgId": "org-123",
  "usageType": "sms",  // sms | api_call
  "quantity": 10,
  "metadata": {
    "to": "+1234567890",
    "status": "delivered",
    "messageId": "msg-789"
  },
  "moduleKey": "notification",      // 可选
  "providerRecordId": "msg-789"     // 可选，用于幂等性
}
```

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "recorded": true,
    "usageId": "uuid",
    "isFree": false,
    "unitPrice": 0.10,
    "amount": 1.00,
    "budgetWarning": null
  }
}
```

**预算警告响应**:
```json
{
  "success": true,
  "data": {
    "recorded": true,
    "usageId": "uuid",
    "isFree": false,
    "unitPrice": 0.10,
    "amount": 1.00,
    "budgetWarning": {
      "currentSpending": 95.00,
      "budget": 100.00,
      "percentage": 95.00,
      "triggeredAlerts": [95],
      "notifyByEmail": true,
      "notifyBySms": false
    }
  }
}
```

**幂等性响应**:
```json
{
  "success": true,
  "data": {
    "recorded": false,
    "usageId": "uuid-existing",
    "isFree": false,
    "unitPrice": 0.10,
    "amount": 1.00,
    "budgetWarning": null,
    "reason": "Usage already recorded (idempotent)"
  }
}
```

---

### 6. 批量记录使用量

**端点**: `POST /api/subscription-service/v1/internal/usage/batch`

**描述**: 批量记录使用量，提高性能

**请求头**:
```
X-API-Key: <service_api_key>
Content-Type: application/json
```

**请求体**:
```json
{
  "orgId": "org-123",
  "records": [
    {
      "usageType": "sms",
      "quantity": 1,
      "metadata": {...},
      "providerRecordId": "msg-1"
    },
    {
      "usageType": "sms",
      "quantity": 1,
      "metadata": {...},
      "providerRecordId": "msg-2"
    }
  ]
}
```

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "recorded": 2,
    "failed": 0,
    "totalAmount": 0.20,
    "budgetWarning": null
  }
}
```

---

### 7. 统计活跃资源

**端点**: `POST /api/subscription-service/v1/internal/stats/active-resources`

**描述**: auth-service定期同步实际的设备/账号数量

**请求头**:
```
X-API-Key: <service_api_key>
Content-Type: application/json
```

**请求体**:
```json
{
  "orgId": "org-123",
  "resources": {
    "pos": 3,
    "kiosk": 0,
    "tablet": 2,
    "manager": 1,
    "staff": 5
  }
}
```

**成功响应** (200 OK):
```json
{
  "success": true,
  "data": {
    "updated": true,
    "quotaStatus": {
      "pos": {
        "quota": 5,
        "used": 3,
        "available": 2,
        "exceeded": false
      },
      "tablet": {
        "quota": 2,
        "used": 2,
        "available": 0,
        "exceeded": false
      },
      "staff": {
        "quota": 3,
        "used": 5,
        "available": 0,
        "exceeded": true
      }
    }
  }
}
```

---

### Part 4 通用错误代码

| 错误代码 | HTTP状态码 | 说明 |
|---------|-----------|------|
| UNAUTHORIZED | 401 | API Key无效或缺失 |
| SUBSCRIPTION_NOT_FOUND | 404 | 订阅不存在 |
| STANDARD_PLAN_NOT_FOUND | 404 | 无ACTIVE StandardPlan |
| USAGE_PRICING_NOT_FOUND | 404 | 使用量定价不存在 |
| DATABASE_ERROR | 500 | 数据库查询错误 |
| INTERNAL_SERVER_ERROR | 500 | 服务器内部错误 |

---

## Part 5: Webhook API

### 📋 概述

**调用者**: Stripe/PayPal等支付商
**鉴权**: Webhook签名验证 (Stripe Signature / PayPal IPN)
**基础路径**: `/api/subscription-service/v1/webhooks`

Part 5负责接收并处理支付商的Webhook通知，实现支付事件的自动化处理和数据同步。

**核心特性**：
- ✅ **签名验证**：Stripe Signature验证，确保请求来源可信
- ✅ **幂等性保证**：数据库去重，防止重复处理（业界最佳实践）
- ✅ **异步处理**：快速响应200，后台处理事件
- ✅ **完整日志**：记录所有事件用于审计追踪
- ✅ **支持12种事件**：覆盖订阅、支付、退款全生命周期

---

### 🎯 支持的事件类型（12个）

#### 订阅生命周期（4个）
1. `checkout.session.completed` - 结账完成（Trial转正式/直接订阅）
2. `customer.subscription.created` - 订阅创建
3. `customer.subscription.updated` - 订阅更新（续费/升级）
4. `customer.subscription.deleted` - 订阅删除

#### 发票和支付（4个）
5. `invoice.created` - 发票创建
6. `invoice.finalized` - 发票确定
7. `invoice.payment_succeeded` - 支付成功
8. `invoice.payment_failed` - 支付失败

#### 支付方式（2个）
9. `payment_method.attached` - 支付方式绑定
10. `payment_method.detached` - 支付方式解绑

#### 其他（2个）
11. `charge.refunded` - 退款
12. `customer.updated` - 客户信息更新

---

### API 1: Stripe Webhook处理器

**POST** `/webhooks/stripe`

处理Stripe发送的所有Webhook事件。

#### 鉴权方式

```http
POST /webhooks/stripe HTTP/1.1
Stripe-Signature: t=1614363600,v1=d7b3f...
Content-Type: application/json
```

**签名验证**：
- Stripe会在请求头中添加 `Stripe-Signature`
- 服务端使用Stripe Secret验证签名
- 签名无效返回400

#### 请求格式

Stripe Webhook的标准格式：

```json
{
  "id": "evt_1234567890abcdef",
  "object": "event",
  "api_version": "2023-10-16",
  "created": 1614363600,
  "type": "invoice.payment_succeeded",
  "livemode": true,
  "data": {
    "object": {
      "id": "in_1234567890abcdef",
      "amount_paid": 19900,
      "customer": "cus_1234567890abcdef",
      "subscription": "sub_1234567890abcdef",
      ...
    }
  }
}
```

#### 响应格式

**成功响应** (200 OK):

```json
{
  "success": true,
  "message": "Webhook received",
  "eventId": "evt_1234567890abcdef"
}
```

**说明**：
- 服务器会立即返回200（异步处理事件）
- Stripe要求在5秒内返回200，否则会重试
- 事件处理在后台异步进行

#### 错误响应

**签名缺失** (400 Bad Request):

```json
{
  "success": false,
  "error": {
    "code": "MISSING_SIGNATURE",
    "message": "Missing Stripe signature header"
  }
}
```

**签名无效** (400 Bad Request):

```json
{
  "success": false,
  "error": {
    "code": "INVALID_SIGNATURE",
    "message": "Invalid Stripe signature"
  }
}
```

**处理错误** (500 Internal Server Error):

```json
{
  "success": false,
  "error": {
    "code": "WEBHOOK_ERROR",
    "message": "Webhook processing error"
  }
}
```

---

### 🔄 事件处理逻辑

#### 1. checkout.session.completed（结账完成）

**触发场景**：
- Trial用户完成首次支付（转正式订阅）
- 新用户跳过Trial直接订阅

**处理逻辑**：
```
1. 查找本地订阅记录（通过Stripe Customer ID）
2. 如果订阅状态为TRIAL:
   - 更新status为ACTIVE
   - 设置startedAt为当前时间
   - 设置renewsAt为30天后
   - 设置trialEndsAt为当前时间
3. 记录SubscriptionLog (TRIAL_ACTIVATED)
```

**数据库变更**：
- `subscriptions.status`: TRIAL → ACTIVE
- `subscriptions.startedAt`: NULL → 当前时间
- `subscriptions.renewsAt`: NULL → +30天

---

#### 2. customer.subscription.updated（订阅更新）

**触发场景**：
- 月度续费（自动扣款成功）
- 订阅升级/降级

**处理逻辑**：
```
1. 查找本地订阅
2. 判断是否为续费（renewsAt已过期 && status=active）
3. 如果是续费：
   - 更新renewsAt为下个月
   - 重置smsCurrentSpending为0
   - 清空smsBudgetAlerts
   - 记录日志 (SUBSCRIPTION_RENEWED)
4. 如果是普通更新：
   - 同步订阅状态
   - 记录日志 (SUBSCRIPTION_UPDATED)
```

**数据库变更（续费）**：
- `subscriptions.renewsAt`: 旧日期 → +30天
- `subscriptions.smsCurrentSpending`: 累积金额 → 0
- `subscriptions.smsBudgetAlerts`: [50,80,...] → []

---

#### 3. invoice.payment_succeeded（支付成功）

**触发场景**：
- 首次支付成功
- 月度续费扣款成功
- 按天计费扣款成功

**处理逻辑**：
```
1. 查找订阅
2. 更新订阅状态为ACTIVE
3. 清除宽限期 (gracePeriodEndsAt → null)
4. 创建或更新Invoice记录：
   - 生成发票号 (INV-2025-01-001)
   - 保存Stripe Invoice数据
   - 状态设为PAID
5. 记录日志 (PAYMENT_SUCCEEDED)
```

**数据库变更**：
- `subscriptions.status`: SUSPENDED → ACTIVE
- `subscriptions.gracePeriodEndsAt`: 日期 → NULL
- `invoices`: 创建新记录或更新status为PAID

---

#### 4. invoice.payment_failed（支付失败）

**触发场景**：
- 续费扣款失败（余额不足、卡过期等）

**处理逻辑**：
```
1. 查找订阅
2. 设置7天宽限期:
   - status更新为SUSPENDED
   - gracePeriodEndsAt设为+7天
   - graceAlertSent设为false
3. 更新Invoice记录:
   - status设为FAILED
   - 记录failureReason
   - retryCount+1
4. 记录日志 (PAYMENT_FAILED)
```

**数据库变更**：
- `subscriptions.status`: ACTIVE → SUSPENDED
- `subscriptions.gracePeriodEndsAt`: NULL → +7天
- `invoices.status`: PENDING → FAILED
- `invoices.retryCount`: +1

**注意**：
- 7天宽限期内用户仍可使用服务
- 超过宽限期后需调用Part 4内部API暂停资源

---

#### 5. payment_method.attached（支付方式绑定）

**触发场景**：
- 用户添加新的支付方式

**处理逻辑**：
```
1. 查找用户（通过Customer ID关联的订阅）
2. Upsert PaymentMethod记录:
   - 保存brand (visa/mastercard)
   - 保存last4
   - 保存expiresAt
   - 设为默认支付方式
```

**数据库变更**：
- `payment_methods`: 创建或更新记录

---

#### 6. charge.refunded（退款）

**触发场景**：
- 管理员执行退款操作
- 用户发起退款请求

**处理逻辑**：
```
1. 查找对应的Invoice（通过Stripe Invoice ID）
2. 更新Invoice状态为REFUNDED
3. 记录SubscriptionLog (CHARGE_REFUNDED)
4. 记录退款金额
```

**数据库变更**：
- `invoices.status`: PAID → REFUNDED

---

### 🔒 安全机制

#### 1. 签名验证

Stripe会使用webhook secret对请求进行签名：

```typescript
const sig = req.headers['stripe-signature'];
const event = stripe.webhooks.constructEvent(
  req.body,
  sig,
  process.env.STRIPE_WEBHOOK_SECRET
);
```

**重要**：
- 必须使用raw body（不能先JSON.parse）
- app.ts中已配置raw body中间件

#### 2. 幂等性保证

使用`webhook_events`表防止重复处理：

```typescript
// 检查事件是否已处理
const existingEvent = await prisma.webhookEvent.findUnique({
  where: { eventId: event.id }
});

if (existingEvent) {
  // 已处理，直接返回
  return;
}

// 处理事件...

// 记录为已处理
await prisma.webhookEvent.create({
  data: {
    eventId: event.id,
    provider: 'stripe',
    eventType: event.type,
    processed: true,
    attempts: 1,
    processedAt: new Date()
  }
});
```

**为什么用数据库而不是Redis？**
- ✅ 100%可靠（Redis可能丢失数据）
- ✅ Stripe官方推荐方案
- ✅ 可审计（查询历史记录）
- ✅ 生产级别（GitHub、Shopify都用此方案）

#### 3. Stripe重试机制

Stripe的webhook重试策略：
- 第1次：立即发送
- 第2次：1小时后
- 第3次：2小时后
- 第4次：4小时后
- 最多重试3天

**我们的处理**：
- 幂等性保证可安全接受重试
- 每次重试会增加`attempts`计数
- 可在数据库中查看重试历史

---

### 📊 Webhook事件表结构

```prisma
model WebhookEvent {
  id          String   @id @default(uuid())
  eventId     String   @unique             // Stripe事件ID (幂等性key)
  provider    String                       // stripe/paypal
  eventType   String                       // 事件类型
  payload     Json?                        // 原始payload（调试用）
  processed   Boolean  @default(true)      // 是否处理成功
  attempts    Int      @default(1)         // 尝试次数
  error       String?                      // 错误信息
  processedAt DateTime                     // 处理时间
  createdAt   DateTime @default(now())
}
```

**索引优化**：
- `eventId`: unique索引（幂等性查询）
- `provider`: 普通索引（按支付商查询）
- `eventType`: 普通索引（按事件类型统计）

---

### 🧪 测试Webhook

#### 使用Stripe CLI

1. 安装Stripe CLI:
```bash
brew install stripe/stripe-cli/stripe
```

2. 登录:
```bash
stripe login
```

3. 转发webhook到本地:
```bash
stripe listen --forward-to localhost:8086/api/subscription-service/v1/webhooks/stripe
```

4. 触发测试事件:
```bash
# 支付成功
stripe trigger invoice.payment_succeeded

# 支付失败
stripe trigger invoice.payment_failed

# 订阅更新
stripe trigger customer.subscription.updated
```

#### 查看处理日志

```bash
# 查看webhook_events表
psql -d subscription-service -c "SELECT * FROM webhook_events ORDER BY created_at DESC LIMIT 10;"

# 查看订阅日志
psql -d subscription-service -c "SELECT * FROM subscription_logs WHERE action LIKE '%WEBHOOK%' ORDER BY created_at DESC LIMIT 10;"
```

---

### ⚠️ 错误代码

| 错误代码 | HTTP状态码 | 说明 |
|----------|-----------|------|
| MISSING_SIGNATURE | 400 | 缺少Stripe签名header |
| INVALID_SIGNATURE | 400 | Stripe签名验证失败 |
| WEBHOOK_ERROR | 500 | Webhook处理过程出错 |

---

### 📝 最佳实践

1. **快速响应**：
   - 必须在5秒内返回200
   - 使用异步处理（不阻塞响应）

2. **幂等性**：
   - 使用数据库去重（不是Redis）
   - 记录事件ID防止重复处理

3. **监控告警**：
   - 监控webhook处理成功率（目标>99.5%）
   - 监控处理时间（目标<2秒）
   - 失败时发送告警

4. **日志记录**：
   - 记录所有事件到`webhook_events`表
   - 关键操作记录到`subscription_logs`表
   - 包含完整的错误堆栈

5. **测试覆盖**：
   - 使用Stripe CLI本地测试
   - 测试重复事件的幂等性
   - 测试签名验证失败场景

---

## 更新日志

### v1.4.0 (2025-10-18)
- ✅ Phase 5: 订阅统计查询API完成开发
- 包含2个端点: 获取统计数据、列出订阅
- 全局统计：订阅概览、收入指标(MRR/ARPU)、转化率、趋势分析
- 支付健康度：发票统计、成功率分析
- 资源使用统计：模块和资源订阅统计
- 列表查询：支持多维度筛选（状态、时间范围、价格范围、支付方式）
- 详细摘要：订阅详情包含模块摘要、资源摘要、使用量统计、最近发票

### v1.3.0 (2025-10-18)
- ✅ Phase 4: Standard Plan管理API完成开发
- 包含7个端点: 创建、查询ACTIVE、列出所有、查询单个、更新、激活、删除
- 支持多版本管理：ACTIVE(当前生效)、ARCHIVED(历史版本)、DELETED(已删除)
- 事务激活机制：激活新版本时自动归档旧版本，确保唯一性
- 引用完整性验证：自动检查包含的模块keys和资源配额的有效性
- 软删除设计：仅可删除ARCHIVED状态版本，ACTIVE版本需先激活其他版本
- 创建时支持activateImmediately选项立即激活
- 更新ACTIVE版本时检查活跃订阅数量并返回警告

### v1.2.0 (2025-10-18)
- ✅ Phase 3: 按量计费管理API完成开发
- 包含5个端点: 创建、列出、查询、更新、更新状态
- 使用boolean类型的isActive字段(启用/禁用)
- 支持4位小数精度的unitPrice
- usageType作为唯一标识
- 禁用时检查未结算使用记录并提供警告
- 不提供DELETE端点,只能通过禁用来停止使用

### v1.1.0 (2025-10-15)
- ✅ Phase 2: 资源管理API完成开发
- 包含6个端点: 创建、列出、查询、更新、删除、更新状态
- 支持POS/Kiosk/Tablet/Manager/Staff 5种资源类型
- 新增standardQuota字段配置Standard Plan包含数量

### v1.0.0 (2025-10-14)
- ✅ Phase 1: 模块管理API完成开发
- 包含6个端点: 创建、列出、查询、更新、删除、更新状态
- 使用API Key鉴权方式
- 移除canTrial字段
