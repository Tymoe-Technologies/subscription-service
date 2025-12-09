# Subscription Service API v2.0.0

## 设计原则

1. **Stripe-First 架构**: Stripe 作为订阅和计费的单一真相源（SSOT）

   - 所有订阅生命周期管理（创建、升级、降级、试用、取消）都在 Stripe 完成
   - 本地数据库是 Stripe 数据的只读镜像，仅通过 Webhook 同步更新
   - 订阅的增删改操作通过 Stripe Checkout 或 Billing Portal 完成

2. **业务抽象**: 前端和 API 使用业务概念（planKey、moduleKey），不暴露 Stripe 实现细节

3. **职责清晰**: 本服务只负责

   - ✅ 产品目录管理（Plan/Module CRUD）
   - ✅ 提供 Stripe 入口（Checkout/Portal Session）
   - ✅ 同步 Stripe 数据到本地（Webhook）
   - ✅ 查询本地镜像数据（只读）
   - ❌ 不负责订阅的直接修改、计费计算、订阅生命周期管理

4. **RESTful 风格**: 使用标准 HTTP 方法和状态码

5. **统一响应格式**: 成功和错误响应保持一致结构

## 基础信息

- **Base URL**: `https://tymoe.com`
- **API 前缀**: `/api/subscription-service/v1`
- **认证方式**:
  - 用户 API: Bearer Token (JWT)
  - 内部 API: Service API Key (Header: X-Service-API-Key)
- **Content-Type**: `application/json`

## 响应格式

**成功响应**:

```json
{
  "success": true,
  "message": "操作成功",
  "data": {}
}
```

**错误响应**:

```json
{
  "success": false,
  "error": "error_code",
  "detail": "错误描述信息"
}
```

---

# 1. 订阅管理 API (`/subscriptions`)

## 1.1 创建订阅 Checkout Session

**端点**: `POST /api/subscription-service/v1/subscriptions/checkout`

**描述**: 创建 Stripe Checkout Session，用户需要跳转到返回的 URL 完成支付

**请求头**:

```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**请求体**:

```json
{
  "orgId": "org-uuid-123",
  "planKey": "basic_plan",
  "moduleKeys": ["appointment", "marketing"]
}
```

**字段说明**:

- `orgId` (必填, string): 组织 ID（长度 1-255）
- `planKey` (必填, string): 订阅计划的业务标识（如：basic_plan、pro_plan、enterprise_plan）
- `moduleKeys` (可选, string[]): 附加模块的业务标识数组（如：["appointment", "marketing"]）

**处理逻辑**:

1. 从 JWT 提取 userId 并验证对 orgId 的权限
2. 验证 planKey 存在且状态为 ACTIVE
3. 验证所有 moduleKeys 存在且状态为 ACTIVE
4. 检查 orgId 是否已有活跃订阅
5. 检查用户 Trial 资格
6. 获取或创建 Stripe Customer
7. 构建 Stripe Checkout Session 参数
8. 调用 Stripe API 创建 Checkout Session
9. 记录到 SubscriptionLog
10. 返回 Checkout Session URL

**成功响应 (200)**:

```json
{
  "success": true,
  "message": "Checkout session created successfully",
  "data": {
    "checkoutUrl": "https://checkout.stripe.com/c/pay/cs_xxx",
    "sessionId": "cs_xxx",
    "expiresAt": "2025-01-15T10:30:00.000Z"
  }
}
```

**错误响应**:

```json
// 400 - 无效的 Plan Key
{
  "success": false,
  "error": "invalid_plan_key",
  "detail": "The provided plan key does not exist or is not active"
}

// 400 - 无效的 Module Key
{
  "success": false,
  "error": "invalid_module_key",
  "detail": "One or more module keys are invalid or not active"
}

// 403 - 权限不足
{
  "success": false,
  "error": "forbidden",
  "detail": "You do not have permission to manage subscriptions for this organization"
}

// 409 - 订阅已存在
{
  "success": false,
  "error": "subscription_exists",
  "detail": "This organization already has an active or trialing subscription"
}

// 502 - Stripe 同步问题
{
  "success": false,
  "error": "plan_not_synced_to_stripe",
  "detail": "The plan has not been synced to Stripe yet. Please contact support."
}
```

---

## 1.2 获取订阅详情

**端点**: `GET /api/subscription-service/v1/subscriptions/:orgId`

**描述**: 获取组织的订阅信息（从本地镜像数据库）

**请求头**:

```
Authorization: Bearer <jwt_token>
```

**路径参数**:

- `orgId` (string): 组织 ID

**处理逻辑**:

1. 从 JWT 验证 orgId 访问权限
2. 查询 Subscription 表获取订阅信息
3. 如果找不到记录返回 404

**成功响应 (200)**:

```json
{
  "success": true,
  "message": "Subscription retrieved successfully",
  "data": {
    "orgId": "org-uuid-123",
    "status": "active",
    "items": [
      {
        "priceId": "price_basic_plan_xxx",
        "moduleKey": "basic_plan",
        "quantity": 1
      },
      {
        "priceId": "price_appointment_xxx",
        "moduleKey": "appointment",
        "quantity": 1
      }
    ],
    "stripeSubscriptionId": "sub_xxx",
    "stripeCustomerId": "cus_xxx",
    "createdAt": "2025-01-15T08:30:00.000Z",
    "updatedAt": "2025-01-15T08:30:00.000Z"
  }
}
```

---

## 1.3 创建 Billing Portal Session

**端点**: `POST /api/subscription-service/v1/subscriptions/:orgId/portal`

**描述**: 创建 Stripe Billing Portal Session，用户通过返回的 URL 跳转到 Stripe Portal 管理订阅（升级、降级、添加/移除模块、取消订阅等）

**请求头**:

```
Authorization: Bearer <jwt_token>
```

**路径参数**:

- `orgId` (string): 组织 ID

**请求体**: 无

**处理逻辑**:

1. 验证 orgId 权限
2. 查询 Subscription 表获取 stripeCustomerId
3. 如果找不到订阅记录,返回 404
4. 调用 Stripe API 创建 Billing Portal Session
5. 记录到 SubscriptionLog
6. 返回 Portal URL

**成功响应 (200)**:

```json
{
  "success": true,
  "message": "Billing portal session created successfully",
  "data": {
    "portalUrl": "https://billing.stripe.com/p/session/xxx"
  }
}
```

**错误响应**:

```json
// 404 - 订阅不存在
{
  "success": false,
  "error": "subscription_not_found",
  "detail": "No active subscription found for this organization"
}

// 403 - 权限不足
{
  "success": false,
  "error": "forbidden",
  "detail": "You do not have permission to manage subscriptions for this organization"
}
```

**说明**:

- 所有订阅修改操作（添加/移除模块、升级/降级 Plan、取消订阅）都应该在 Stripe Billing Portal 中完成
- Portal 中的任何操作都会触发 Webhook 事件,自动同步到本地数据库
- 本服务不提供直接修改订阅的 API

---

# 2. 产品目录 API (`/catalog`)

> 公开接口，无需认证。用于前端展示可选的订阅计划和附加模块。

## 2.1 获取所有可用 Plans

**端点**: `GET /api/subscription-service/v1/catalog/plans`

**描述**: 获取所有状态为 ACTIVE 的订阅计划列表，供用户选择订阅

**认证**: 无需认证（公开接口）

**处理逻辑**:

1. 查询 Plan 表，筛选 status = ACTIVE
2. 按 monthlyPrice 升序排序
3. 返回 Plan 列表（不包含 Stripe IDs 等敏感信息）

**成功响应 (200)**:

```json
{
  "success": true,
  "message": "Plans retrieved successfully",
  "data": {
    "plans": [
      {
        "key": "starter",
        "name": "Starter Plan",
        "description": "适合小型商户的入门计划",
        "monthlyPrice": "99.00",
        "includedModules": [{ "moduleKey": "booking", "quantity": 1 }],
        "trialDurationDays": 14
      },
      {
        "key": "pro",
        "name": "Pro Plan",
        "description": "适合成长中商户的专业计划",
        "monthlyPrice": "199.00",
        "includedModules": [
          { "moduleKey": "booking", "quantity": 1 },
          { "moduleKey": "manager", "quantity": 3 },
          { "moduleKey": "analytics", "quantity": 1 }
        ],
        "trialDurationDays": 14
      }
    ]
  }
}
```

**字段说明**:

- `key`: Plan 的业务标识，用于创建订阅时传递
- `name`: Plan 显示名称
- `description`: Plan 描述
- `monthlyPrice`: 月费价格（字符串格式的 Decimal）
- `includedModules`: Plan 包含的模块列表
- `trialDurationDays`: 试用期天数

**注意**: 响应不包含 `id`, `status`, `stripePriceId`, `stripeProductId` 等内部/敏感字段

---

## 2.2 获取单个 Plan 详情

**端点**: `GET /api/subscription-service/v1/catalog/plans/:key`

**描述**: 根据 Plan Key 获取单个 Plan 的详细信息

**认证**: 无需认证（公开接口）

**路径参数**:

- `key` (string): Plan 的业务标识

**处理逻辑**:

1. 根据 key 查询 Plan
2. 验证 status = ACTIVE（非 ACTIVE 的 Plan 不对外展示）
3. 返回 Plan 详情

**成功响应 (200)**:

```json
{
  "success": true,
  "message": "Plan retrieved successfully",
  "data": {
    "key": "pro",
    "name": "Pro Plan",
    "description": "适合成长中商户的专业计划",
    "monthlyPrice": "199.00",
    "includedModules": [
      { "moduleKey": "booking", "quantity": 1 },
      { "moduleKey": "manager", "quantity": 3 }
    ],
    "trialDurationDays": 14
  }
}
```

**错误响应**:

```json
// 404 - Plan 不存在或不可用
{
  "success": false,
  "error": "plan_not_found",
  "detail": "Plan not found or not available"
}
```

---

## 2.3 获取所有可用 Modules

**端点**: `GET /api/subscription-service/v1/catalog/modules`

**描述**: 获取所有状态为 ACTIVE 的附加模块列表，供用户选择购买

**认证**: 无需认证（公开接口）

**处理逻辑**:

1. 查询 Module 表，筛选 status = ACTIVE
2. 按 monthlyPrice 升序排序
3. 返回 Module 列表（不包含 Stripe IDs 等敏感信息）

**成功响应 (200)**:

```json
{
  "success": true,
  "message": "Modules retrieved successfully",
  "data": {
    "modules": [
      {
        "key": "manager",
        "name": "Manager Seats",
        "description": "额外的管理员席位",
        "monthlyPrice": "20.00",
        "dependencies": [],
        "allowMultiple": true
      },
      {
        "key": "kiosk",
        "name": "Kiosk Device",
        "description": "自助服务终端设备授权",
        "monthlyPrice": "30.00",
        "dependencies": [],
        "allowMultiple": true
      },
      {
        "key": "analytics",
        "name": "Advanced Analytics",
        "description": "高级数据分析功能",
        "monthlyPrice": "50.00",
        "dependencies": [],
        "allowMultiple": false
      }
    ]
  }
}
```

**字段说明**:

- `key`: Module 的业务标识，用于创建订阅时传递
- `name`: Module 显示名称
- `description`: Module 描述
- `monthlyPrice`: 月费价格（字符串格式的 Decimal）
- `dependencies`: 依赖的其他模块 key 数组
- `allowMultiple`: 是否允许购买多个（如 manager 席位、kiosk 数量）

**注意**: 响应不包含 `id`, `status`, `version`, `stripePriceId`, `stripeProductId` 等内部/敏感字段

---

## 2.4 获取单个 Module 详情

**端点**: `GET /api/subscription-service/v1/catalog/modules/:key`

**描述**: 根据 Module Key 获取单个 Module 的详细信息

**认证**: 无需认证（公开接口）

**路径参数**:

- `key` (string): Module 的业务标识

**处理逻辑**:

1. 根据 key 查询 Module
2. 验证 status = ACTIVE（非 ACTIVE 的 Module 不对外展示）
3. 返回 Module 详情

**成功响应 (200)**:

```json
{
  "success": true,
  "message": "Module retrieved successfully",
  "data": {
    "key": "analytics",
    "name": "Advanced Analytics",
    "description": "高级数据分析功能",
    "monthlyPrice": "50.00",
    "dependencies": [],
    "allowMultiple": false
  }
}
```

**错误响应**:

```json
// 404 - Module 不存在或不可用
{
  "success": false,
  "error": "module_not_found",
  "detail": "Module not found or not available"
}
```

---

# 3. 管理员 API (`/admin`)

## 基础信息

- **认证方式**: Admin API Key (Header: X-Admin-API-Key)
- **用途**: 管理产品目录(Plan 和 Module),同步数据到 Stripe
- **权限**: 仅限管理员使用,需要配置环境变量 `ADMIN_API_KEYS`

---

## 3.1 创建 Plan

**端点**: `POST /api/subscription-service/v1/admin/plans`

**描述**: 创建新的订阅计划(Plan)并可选同步到 Stripe

**请求头**:

```
X-Admin-API-Key: <admin_api_key>
Content-Type: application/json
```

**请求体**:

```json
{
  "key": "standard_plan",
  "name": "Standard Plan",
  "version": "v1.0",
  "description": "基础订阅计划,包含核心功能",
  "monthlyPrice": 199.0,
  "includedModules": [
    { "moduleKey": "appointment", "quantity": 1 },
    { "moduleKey": "member", "quantity": 1 },
    { "moduleKey": "manager", "quantity": 3 }
  ],
  "trialDurationDays": 30,
  "syncToStripe": true,
  "stripeProductId": "prod_xxxxx"
}
```

**字段说明**:

- `key` (必填, string): Plan 的业务标识,全局唯一 (1-100 字符)
- `name` (必填, string): Plan 显示名称 (1-255 字符)
- `version` (必填, string): Plan 版本号,全局唯一 (1-255 字符)
- `description` (可选, string): Plan 描述信息
- `monthlyPrice` (必填, number): 月费价格 (Decimal 10,2)
- `includedModules` (可选, array): 包含的模块列表,每个元素包含:
  - `moduleKey` (string): 模块的业务标识
  - `quantity` (number): 数量 (默认为 1,allowMultiple 模块可设置更大值)
- `trialDurationDays` (必填, number): 试用期天数 (整数)
- `status` (可选, string): Plan 初始状态,默认为 ACTIVE (PENDING | ACTIVE | ARCHIVED)
- `syncToStripe` (可选, boolean): 是否立即同步到 Stripe,默认为 false
- `stripeProductId` (可选, string): 如果已在 Stripe 创建 Product,提供 Product ID;否则自动创建

**处理逻辑**:

1. 验证 Admin API Key
2. 验证请求体字段(Zod schema)
3. 检查 `key` 是否已存在
4. 检查 `version` 是否已存在
5. 生成 UUID 作为 id
6. 创建 Plan 记录到数据库
7. 如果 `syncToStripe=true`:
   - 如果未提供 `stripeProductId`,调用 Stripe API 创建 Product
   - 调用 Stripe API 创建 Price (基于 monthlyPrice)
   - 将返回的 `stripePriceId` 更新到 Plan 记录
8. 返回创建的 Plan 信息

**成功响应 (201)**:

```json
{
  "success": true,
  "message": "Plan created successfully",
  "data": {
    "id": "uuid-xxxxx",
    "key": "standard_plan",
    "name": "Standard Plan",
    "version": "v1.0",
    "description": "基础订阅计划,包含核心功能",
    "monthlyPrice": 199.0,
    "includedModules": [
      { "moduleKey": "appointment", "quantity": 1 },
      { "moduleKey": "member", "quantity": 1 },
      { "moduleKey": "manager", "quantity": 3 }
    ],
    "trialDurationDays": 30,
    "status": "ACTIVE",
    "stripePriceId": "price_1xxxxx",
    "createdAt": "2025-11-19T12:00:00.000Z",
    "updatedAt": "2025-11-19T12:00:00.000Z"
  }
}
```

**错误响应**:

```json
// 401 - 无效的Admin API Key
{
  "success": false,
  "error": "invalid_admin_api_key",
  "detail": "The provided Admin API Key is invalid"
}

// 400 - 请求体验证失败
{
  "success": false,
  "error": "validation_error",
  "detail": "Invalid request body: key is required"
}

// 409 - Plan Key已存在
{
  "success": false,
  "error": "plan_key_exists",
  "detail": "A plan with this key already exists"
}

// 409 - Plan版本已存在
{
  "success": false,
  "error": "plan_version_exists",
  "detail": "A plan with this version already exists"
}

// 502 - Stripe Price创建失败
{
  "success": false,
  "error": "stripe_price_creation_failed",
  "detail": "Failed to create price in Stripe: [Stripe error message]"
}
```

---

## 3.2 查询所有 Plan

**端点**: `GET /api/subscription-service/v1/admin/plans`

**描述**: 查询所有订阅计划列表,支持筛选

**请求头**:

```
X-Admin-API-Key: <admin_api_key>
```

**查询参数**:

- `status` (可选, string): 按状态筛选 (ACTIVE | INACTIVE | ARCHIVED)
- `syncStatus` (可选, string): 按同步状态筛选 (synced | unsynced)
  - `synced`: stripePriceId 不为空
  - `unsynced`: stripePriceId 为空

**处理逻辑**:

1. 验证 Admin API Key
2. 构建查询条件(根据查询参数)
3. 查询 Plan 表
4. 返回 Plan 列表

**成功响应 (200)**:

```json
{
  "success": true,
  "message": "Plans retrieved successfully",
  "data": {
    "plans": [
      {
        "id": "uuid-xxxxx",
        "key": "standard_plan",
        "name": "Standard Plan",
        "version": "v1.0",
        "monthlyPrice": 199.0,
        "status": "ACTIVE",
        "stripePriceId": "price_1xxxxx",
        "syncedToStripe": true,
        "createdAt": "2025-11-19T12:00:00.000Z"
      },
      {
        "id": "uuid-yyyyy",
        "key": "pro_plan",
        "name": "Pro Plan",
        "version": "v1.0",
        "monthlyPrice": 499.0,
        "status": "ACTIVE",
        "stripePriceId": null,
        "syncedToStripe": false,
        "createdAt": "2025-11-18T10:00:00.000Z"
      }
    ],
    "total": 2
  }
}
```

---

## 3.3 查询单个 Plan

**端点**: `GET /api/subscription-service/v1/admin/plans/:id`

**描述**: 根据 ID 查询 Plan 详细信息

**请求头**:

```
X-Admin-API-Key: <admin_api_key>
```

**路径参数**:

- `id` (string): Plan 的 UUID

**处理逻辑**:

1. 验证 Admin API Key
2. 根据 id 查询 Plan 表
3. 如果找不到返回 404
4. 返回 Plan 详情

**成功响应 (200)**:

```json
{
  "success": true,
  "message": "Plan retrieved successfully",
  "data": {
    "id": "uuid-xxxxx",
    "key": "standard_plan",
    "name": "Standard Plan",
    "version": "v1.0",
    "description": "基础订阅计划,包含核心功能",
    "monthlyPrice": 199.0,
    "includedModules": [
      { "moduleKey": "appointment", "quantity": 1 },
      { "moduleKey": "member", "quantity": 1 }
    ],
    "trialDurationDays": 30,
    "status": "ACTIVE",
    "stripePriceId": "price_1xxxxx",
    "createdAt": "2025-11-19T12:00:00.000Z",
    "updatedAt": "2025-11-19T12:00:00.000Z"
  }
}
```

**错误响应**:

```json
// 404 - Plan不存在
{
  "success": false,
  "error": "plan_not_found",
  "detail": "Plan with the specified ID was not found"
}
```

---

## 3.4 更新 Plan

**端点**: `PATCH /api/subscription-service/v1/admin/plans/:id`

**描述**: 更新 Plan 信息(不包括 key)

**请求头**:

```
X-Admin-API-Key: <admin_api_key>
Content-Type: application/json
```

**路径参数**:

- `id` (string): Plan 的 UUID

**请求体** (所有字段都是可选的):

```json
{
  "name": "Standard Plan (Updated)",
  "version": "v1.1",
  "description": "更新后的描述",
  "monthlyPrice": 249.0,
  "includedModules": [
    { "moduleKey": "appointment", "quantity": 1 },
    { "moduleKey": "member", "quantity": 1 },
    { "moduleKey": "manager", "quantity": 3 }
  ],
  "trialDurationDays": 14,
  "status": "ACTIVE"
}
```

**字段说明**:

- 所有字段都是可选的,只更新提供的字段
- **不允许更新**: `key`, `stripePriceId` (这些字段由系统管理)
- `version` (可选, string): 可以更新版本号
- `monthlyPrice` (可选, number): 如果修改价格,会自动同步到 Stripe(创建新 Price 并停用旧 Price)
- `status` (可选, string): Plan 状态 (PENDING | ACTIVE | ARCHIVED | DELETED)
- `includedModules` (可选, array): 包含的模块列表,每个元素包含 `moduleKey` 和 `quantity`

**处理逻辑**:

1. 验证 Admin API Key
2. 根据 id 查询 Plan
3. 如果找不到返回 404
4. 验证请求体字段
5. 更新 Plan 记录
6. 如果修改了 `monthlyPrice`,自动同步到 Stripe:
   - 在现有 Product 下创建新 Price
   - 停用旧 Price
   - 更新 `stripePriceId`
7. 更新 `updatedAt` 时间戳
8. 返回更新后的 Plan 信息

**成功响应 (200)**:

```json
{
  "success": true,
  "message": "Plan updated successfully",
  "data": {
    "id": "uuid-xxxxx",
    "key": "standard_plan",
    "name": "Standard Plan (Updated)",
    "version": "v1.1",
    "description": "更新后的描述",
    "monthlyPrice": 249.0,
    "includedModules": [
      { "moduleKey": "appointment", "quantity": 1 },
      { "moduleKey": "member", "quantity": 1 },
      { "moduleKey": "manager", "quantity": 3 }
    ],
    "trialDurationDays": 14,
    "status": "ACTIVE",
    "stripePriceId": "price_1xxxxx",
    "createdAt": "2025-11-19T12:00:00.000Z",
    "updatedAt": "2025-11-19T14:30:00.000Z"
  }
}
```

---

## 3.5 同步 Plan 到 Stripe

**端点**: `PATCH /api/subscription-service/v1/admin/plans/:id/sync-stripe`

**描述**: 手动同步 Plan 到 Stripe,创建或更新 Stripe Price

**请求头**:

```
X-Admin-API-Key: <admin_api_key>
Content-Type: application/json
```

**路径参数**:

- `id` (string): Plan 的 UUID

**请求体** (可选):

```json
{
  "stripeProductId": "prod_xxxxx",
  "forceUpdate": false
}
```

**字段说明**:

- `stripeProductId` (可选, string): 如果已在 Stripe 创建 Product,提供 Product ID;否则自动创建
- `forceUpdate` (可选, boolean): 如果 Plan 已有 stripePriceId,是否强制创建新 Price (默认 false)

**处理逻辑**:

1. 验证 Admin API Key
2. 根据 id 查询 Plan
3. 如果找不到返回 404
4. 检查是否已有 `stripePriceId`:
   - 如果有且 `forceUpdate=false`,返回 409 错误
   - 如果有且 `forceUpdate=true`,创建新 Price
5. 如果未提供 `stripeProductId`,调用 Stripe API 创建 Product
6. 调用 Stripe API 创建 Price
7. 更新 Plan 的 `stripePriceId` 字段
8. 更新 `updatedAt` 时间戳
9. 返回更新后的 Plan 信息

**成功响应 (200)**:

```json
{
  "success": true,
  "message": "Plan synced to Stripe successfully",
  "data": {
    "id": "uuid-xxxxx",
    "key": "standard_plan",
    "name": "Standard Plan",
    "stripePriceId": "price_1xxxxx",
    "stripeProductId": "prod_xxxxx",
    "syncedAt": "2025-11-19T15:00:00.000Z"
  }
}
```

**错误响应**:

```json
// 409 - Plan已同步
{
  "success": false,
  "error": "plan_already_synced",
  "detail": "Plan already has a Stripe Price ID. Use forceUpdate=true to create a new price."
}

// 502 - Stripe API错误
{
  "success": false,
  "error": "stripe_price_creation_failed",
  "detail": "Failed to create price in Stripe: Invalid API key provided"
}
```

---

## 3.6 删除 Plan (软删除)

**端点**: `DELETE /api/subscription-service/v1/admin/plans/:id`

**描述**: 软删除 Plan,将状态设为 DELETED 并停用 Stripe Product

**请求头**:

```
X-Admin-API-Key: <admin_api_key>
```

**路径参数**:

- `id` (string): Plan 的 UUID

**处理逻辑**:

1. 验证 Admin API Key
2. 根据 id 查询 Plan
3. 如果找不到返回 404
4. 如果 Plan 有 stripeProductId,调用 Stripe API 停用 Product (设置 active=false)
5. 更新 Plan 状态为 DELETED
6. 更新 `updatedAt` 时间戳
7. 返回成功响应

**成功响应 (200)**:

```json
{
  "success": true,
  "message": "Plan deleted successfully",
  "data": {
    "id": "uuid-xxxxx",
    "key": "standard_plan",
    "status": "DELETED"
  }
}
```

**错误响应**:

```json
// 404 - Plan不存在
{
  "success": false,
  "error": "plan_not_found",
  "detail": "Plan with the specified ID was not found"
}
```

**说明**:

- 这是软删除操作,数据库中的记录不会被物理删除
- Plan 状态会变为 DELETED,不会在 API 查询中返回(除非明确筛选)
- 可以通过更新 Plan 的 status 字段恢复为 ACTIVE

---

## 3.7 创建 Module

**端点**: `POST /api/subscription-service/v1/admin/modules`

**描述**: 创建新的功能模块(Module)并可选同步到 Stripe

**请求头**:

```
X-Admin-API-Key: <admin_api_key>
Content-Type: application/json
```

**请求体**:

```json
{
  "key": "marketing",
  "name": "Marketing Module",
  "version": "v1.0",
  "description": "营销自动化模块,包含邮件营销、短信营销等功能",
  "monthlyPrice": 50.0,
  "dependencies": ["member"],
  "allowMultiple": true,
  "status": "ACTIVE",
  "syncToStripe": true,
  "stripeProductId": "prod_yyyyy"
}
```

**字段说明**:

- `key` (必填, string): Module 的业务标识,全局唯一 (1-100 字符)
- `name` (必填, string): Module 显示名称 (1-255 字符)
- `version` (必填, string): Module 版本号,全局唯一 (1-255 字符)
- `description` (可选, string): Module 描述信息
- `monthlyPrice` (必填, number): 月费价格 (Decimal 10,2)
- `dependencies` (可选, array): 依赖的其他模块 key 数组,JSON 格式 (默认为空数组)
- `allowMultiple` (可选, boolean): 是否允许购买多个,默认为 false (如 manager/kiosk 可设为 true,booking-service 设为 false)
- `status` (可选, string): Module 初始状态,默认为 ACTIVE (ACTIVE | COMING_SOON | DEPRECATED)
- `syncToStripe` (可选, boolean): 是否立即同步到 Stripe,默认为 false
- `stripeProductId` (可选, string): 如果已在 Stripe 创建 Product,提供 Product ID;否则自动创建

**处理逻辑**:

1. 验证 Admin API Key
2. 验证请求体字段(Zod schema)
3. 检查 `key` 是否已存在
4. 检查 `version` 是否已存在
5. 验证 `dependencies` 中的模块是否存在
6. 生成 UUID 作为 id
7. 创建 Module 记录到数据库
8. 如果 `syncToStripe=true`:
   - 如果未提供 `stripeProductId`,调用 Stripe API 创建 Product
   - 调用 Stripe API 创建 Price (基于 monthlyPrice)
   - 将返回的 `stripePriceId` 更新到 Module 记录
9. 返回创建的 Module 信息

**成功响应 (201)**:

```json
{
  "success": true,
  "message": "Module created successfully",
  "data": {
    "id": "uuid-zzzzz",
    "key": "marketing",
    "name": "Marketing Module",
    "version": "v1.0",
    "description": "营销自动化模块,包含邮件营销、短信营销等功能",
    "monthlyPrice": 50.0,
    "dependencies": ["member"],
    "allowMultiple": true,
    "status": "ACTIVE",
    "stripePriceId": "price_2xxxxx",
    "createdAt": "2025-11-19T12:00:00.000Z",
    "updatedAt": "2025-11-19T12:00:00.000Z"
  }
}
```

**错误响应**:

```json
// 409 - Module Key已存在
{
  "success": false,
  "error": "module_key_exists",
  "detail": "A module with this key already exists"
}

// 409 - Module版本已存在
{
  "success": false,
  "error": "module_version_exists",
  "detail": "A module with this version already exists"
}

// 400 - 依赖的模块不存在
{
  "success": false,
  "error": "invalid_module_dependency",
  "detail": "Dependency module 'member' does not exist"
}
```

---

## 3.8 查询所有 Module

**端点**: `GET /api/subscription-service/v1/admin/modules`

**描述**: 查询所有功能模块列表,支持筛选

**请求头**:

```
X-Admin-API-Key: <admin_api_key>
```

**查询参数**:

- `status` (可选, string): 按状态筛选 (ACTIVE | INACTIVE | ARCHIVED)
- `syncStatus` (可选, string): 按同步状态筛选 (synced | unsynced)

**处理逻辑**:

1. 验证 Admin API Key
2. 构建查询条件(根据查询参数)
3. 查询 Module 表
4. 返回 Module 列表

**成功响应 (200)**:

```json
{
  "success": true,
  "message": "Modules retrieved successfully",
  "data": {
    "modules": [
      {
        "id": "uuid-zzzzz",
        "key": "marketing",
        "name": "Marketing Module",
        "version": "v1.0",
        "monthlyPrice": 50.0,
        "dependencies": ["member"],
        "status": "ACTIVE",
        "stripePriceId": "price_2xxxxx",
        "syncedToStripe": true,
        "createdAt": "2025-11-19T12:00:00.000Z"
      },
      {
        "id": "uuid-aaaaa",
        "key": "analytics",
        "name": "Analytics Module",
        "version": "v1.0",
        "monthlyPrice": 80.0,
        "dependencies": [],
        "status": "ACTIVE",
        "stripePriceId": null,
        "syncedToStripe": false,
        "createdAt": "2025-11-18T10:00:00.000Z"
      }
    ],
    "total": 2
  }
}
```

---

## 3.9 查询单个 Module

**端点**: `GET /api/subscription-service/v1/admin/modules/:id`

**描述**: 根据 ID 查询 Module 详细信息

**请求头**:

```
X-Admin-API-Key: <admin_api_key>
```

**路径参数**:

- `id` (string): Module 的 UUID

**处理逻辑**:

1. 验证 Admin API Key
2. 根据 id 查询 Module 表
3. 如果找不到返回 404
4. 返回 Module 详情

**成功响应 (200)**:

```json
{
  "success": true,
  "message": "Module retrieved successfully",
  "data": {
    "id": "uuid-zzzzz",
    "key": "marketing",
    "name": "Marketing Module",
    "version": "v1.0",
    "description": "营销自动化模块,包含邮件营销、短信营销等功能",
    "monthlyPrice": 50.0,
    "dependencies": ["member"],
    "allowMultiple": true,
    "status": "ACTIVE",
    "stripePriceId": "price_2xxxxx",
    "createdAt": "2025-11-19T12:00:00.000Z",
    "updatedAt": "2025-11-19T12:00:00.000Z"
  }
}
```

**错误响应**:

```json
// 404 - Module不存在
{
  "success": false,
  "error": "module_not_found",
  "detail": "Module with the specified ID was not found"
}
```

---

## 3.10 更新 Module

**端点**: `PATCH /api/subscription-service/v1/admin/modules/:id`

**描述**: 更新 Module 信息(不包括 key)

**请求头**:

```
X-Admin-API-Key: <admin_api_key>
Content-Type: application/json
```

**路径参数**:

- `id` (string): Module 的 UUID

**请求体** (所有字段都是可选的):

```json
{
  "name": "Marketing Module (Enhanced)",
  "version": "v1.1",
  "description": "增强版营销模块",
  "monthlyPrice": 60.0,
  "dependencies": ["member", "analytics"],
  "allowMultiple": true,
  "status": "ACTIVE"
}
```

**字段说明**:

- 所有字段都是可选的,只更新提供的字段
- **不允许更新**: `key`, `stripePriceId` (这些字段由系统管理)
- `version` (可选, string): 可以更新版本号
- `monthlyPrice` (可选, number): 如果修改价格,会自动同步到 Stripe(创建新 Price 并停用旧 Price)
- `status` (可选, string): Module 状态 (ACTIVE | COMING_SOON | DEPRECATED | SUSPENDED)
- 更新 `dependencies` 时会验证依赖模块是否存在

**处理逻辑**:

1. 验证 Admin API Key
2. 根据 id 查询 Module
3. 如果找不到返回 404
4. 验证请求体字段
5. 如果更新了 `dependencies`,验证依赖模块是否存在
6. 更新 Module 记录
7. 如果修改了 `monthlyPrice`,自动同步到 Stripe:
   - 在现有 Product 下创建新 Price
   - 停用旧 Price
   - 更新 `stripePriceId`
8. 更新 `updatedAt` 时间戳
9. 返回更新后的 Module 信息

**成功响应 (200)**:

```json
{
  "success": true,
  "message": "Module updated successfully",
  "data": {
    "id": "uuid-zzzzz",
    "key": "marketing",
    "name": "Marketing Module (Enhanced)",
    "version": "v1.1",
    "description": "增强版营销模块",
    "monthlyPrice": 60.0,
    "dependencies": ["member", "analytics"],
    "allowMultiple": true,
    "status": "ACTIVE",
    "stripePriceId": "price_2xxxxx",
    "createdAt": "2025-11-19T12:00:00.000Z",
    "updatedAt": "2025-11-19T16:00:00.000Z"
  }
}
```

---

## 3.11 同步 Module 到 Stripe

**端点**: `PATCH /api/subscription-service/v1/admin/modules/:id/sync-stripe`

**描述**: 手动同步 Module 到 Stripe,创建或更新 Stripe Price

**请求头**:

```
X-Admin-API-Key: <admin_api_key>
Content-Type: application/json
```

**路径参数**:

- `id` (string): Module 的 UUID

**请求体** (可选):

```json
{
  "stripeProductId": "prod_yyyyy",
  "forceUpdate": false
}
```

**字段说明**:

- `stripeProductId` (可选, string): 如果已在 Stripe 创建 Product,提供 Product ID;否则自动创建
- `forceUpdate` (可选, boolean): 如果 Module 已有 stripePriceId,是否强制创建新 Price (默认 false)

**处理逻辑**:

1. 验证 Admin API Key
2. 根据 id 查询 Module
3. 如果找不到返回 404
4. 检查是否已有 `stripePriceId`:
   - 如果有且 `forceUpdate=false`,返回 409 错误
   - 如果有且 `forceUpdate=true`,创建新 Price
5. 如果未提供 `stripeProductId`,调用 Stripe API 创建 Product
6. 调用 Stripe API 创建 Price
7. 更新 Module 的 `stripePriceId` 字段
8. 更新 `updatedAt` 时间戳
9. 返回更新后的 Module 信息

**成功响应 (200)**:

```json
{
  "success": true,
  "message": "Module synced to Stripe successfully",
  "data": {
    "id": "uuid-zzzzz",
    "key": "marketing",
    "name": "Marketing Module",
    "stripePriceId": "price_2xxxxx",
    "stripeProductId": "prod_yyyyy",
    "syncedAt": "2025-11-19T16:30:00.000Z"
  }
}
```

**错误响应**:

```json
// 409 - Module已同步
{
  "success": false,
  "error": "module_already_synced",
  "detail": "Module already has a Stripe Price ID. Use forceUpdate=true to create a new price."
}
```

---

## 3.12 删除 Module (软删除)

**端点**: `DELETE /api/subscription-service/v1/admin/modules/:id`

**描述**: 软删除 Module,将状态设为 SUSPENDED 并停用 Stripe Product

**请求头**:

```
X-Admin-API-Key: <admin_api_key>
```

**路径参数**:

- `id` (string): Module 的 UUID

**处理逻辑**:

1. 验证 Admin API Key
2. 根据 id 查询 Module
3. 如果找不到返回 404
4. 如果 Module 有 stripeProductId,调用 Stripe API 停用 Product (设置 active=false)
5. 更新 Module 状态为 SUSPENDED
6. 更新 `updatedAt` 时间戳
7. 返回成功响应

**成功响应 (200)**:

```json
{
  "success": true,
  "message": "Module deleted successfully",
  "data": {
    "id": "uuid-zzzzz",
    "key": "marketing",
    "status": "SUSPENDED"
  }
}
```

**错误响应**:

```json
// 404 - Module不存在
{
  "success": false,
  "error": "module_not_found",
  "detail": "Module with the specified ID was not found"
}
```

**说明**:

- 这是软删除操作,数据库中的记录不会被物理删除
- Module 状态会变为 SUSPENDED,不会在 API 查询中返回(除非明确筛选)
- 可以通过更新 Module 的 status 字段恢复为 ACTIVE

---

# 4. 查询 API (`/queries`)

## 4.1 获取组织订阅详情

**端点**: `GET /api/subscription-service/v1/queries/orgs/:orgId/subscription`

**描述**: 获取组织的完整订阅信息，包括订阅状态、权限列表、Trial 资格等

**请求头**:

```
Authorization: Bearer <jwt_token>
```

**路径参数**:

- `orgId` (string): 组织 ID

**处理逻辑**:

1. 验证 JWT token
2. 从 JWT 提取 userId
3. 验证用户对 orgId 的访问权限
4. 查询 Subscription 表获取订阅信息
5. 查询 UserTrialStatus 表获取 Trial 资格
6. 从订阅的 items 字段解析 planKey 和 moduleKeys
7. 计算权限和功能列表
8. 返回完整的订阅详情

**成功响应 (200)**:

```json
{
  "success": true,
  "message": "Organization subscription retrieved successfully",
  "data": {
    "subscription": {
      "status": "active",
      "planKey": "pro",
      "planName": "Pro Plan",
      "moduleKeys": ["analytics", "export"],
      "trialEndsAt": null,
      "currentPeriodEnd": "2024-02-15T00:00:00Z",
      "stripeSubscriptionId": "sub_xxx",
      "stripeCustomerId": "cus_xxx"
    },
    "permissions": {
      "features": ["advanced-analytics", "bulk-export", "api-access"],
      "includedModules": ["analytics", "export"]
    },
    "trial": {
      "hasUsedTrial": true,
      "canStartTrial": false,
      "trialActivatedAt": "2024-01-01T00:00:00Z"
    }
  }
}
```

**错误响应**:

```json
// 401 - Token 无效或过期
{
  "success": false,
  "error": "unauthorized",
  "detail": "Invalid or expired JWT token"
}

// 403 - 无权限访问
{
  "success": false,
  "error": "forbidden",
  "detail": "You don't have permission to access this organization's subscription"
}

// 404 - 订阅不存在
{
  "success": false,
  "error": "subscription_not_found",
  "detail": "No subscription found for this organization"
}
```

---

# 5. 内部 API (`/internal`)

> 内部 API 仅供其他微服务调用，需要 Service API Key 认证

## 5.1 获取组织模块配额

**端点**: `GET /api/subscription-service/v1/internal/org/:orgId/module-quotas`

**描述**: 获取组织已购买的所有模块及其配额数量，供 auth-service 等内部服务查询

**请求头**:

```
X-Service-API-Key: <service_api_key>
```

**路径参数**:

- `orgId` (string): 组织 ID

**处理逻辑**:

1. 验证 Service API Key
2. 查询 Subscription 表，获取该组织的订阅记录
3. 解析 items 数组，提取所有模块及其购买数量
4. 查询 Plan 包含的模块（includedModuleKeys）
5. 合并返回完整的配额列表

**成功响应 (200)**:

```json
{
  "success": true,
  "message": "Module quotas retrieved successfully",
  "data": {
    "orgId": "org-uuid-123",
    "subscriptionStatus": "active",
    "planKey": "pro",
    "quotas": [
      {
        "moduleKey": "manager",
        "purchasedCount": 3,
        "allowMultiple": true,
        "source": "addon"
      },
      {
        "moduleKey": "kiosk",
        "purchasedCount": 5,
        "allowMultiple": true,
        "source": "addon"
      },
      {
        "moduleKey": "analytics",
        "purchasedCount": 1,
        "allowMultiple": false,
        "source": "plan_included"
      },
      {
        "moduleKey": "booking",
        "purchasedCount": 1,
        "allowMultiple": false,
        "source": "plan_included"
      }
    ]
  }
}
```

**字段说明**:

- `subscriptionStatus`: 订阅状态 (active, trialing, past_due, canceled, none)
- `planKey`: 当前订阅的 Plan 标识
- `quotas[].moduleKey`: 模块标识
- `quotas[].purchasedCount`: 购买的数量
- `quotas[].allowMultiple`: 该模块是否允许购买多个
- `quotas[].source`: 来源 - "plan_included"(Plan 自带) 或 "addon"(额外购买)

**无订阅响应 (200)**:

```json
{
  "success": true,
  "message": "No active subscription found",
  "data": {
    "orgId": "org-uuid-123",
    "subscriptionStatus": "none",
    "planKey": null,
    "quotas": []
  }
}
```

**错误响应**:

```json
// 401 - Service API Key 无效
{
  "success": false,
  "error": "unauthorized",
  "detail": "Invalid or missing Service API Key"
}
```

---

# 6. Webhook API (`/webhooks`)

## 6.1 Stripe Webhook 处理

**端点**: `POST /api/subscription-service/v1/webhooks/stripe`

**描述**: 接收并处理 Stripe 事件

**请求头**:

```
Stripe-Signature: t=<timestamp>,v1=<signature>
Content-Type: application/json (raw body)
```

**处理的事件类型**:

- checkout.session.completed
- customer.subscription.created
- customer.subscription.updated
- customer.subscription.deleted
- invoice.payment_succeeded
- invoice.payment_failed

**处理逻辑**:

1. 验证 Stripe 签名
2. 检查重复处理（幂等性）
3. 根据事件类型执行对应处理
4. 记录到 WebhookEvent 表
5. 返回 200 OK

**成功响应 (200)**:

```json
{
  "received": true
}
```

---

# 错误码参考

| 错误代码                       | HTTP | 说明                        |
| ------------------------------ | ---- | --------------------------- |
| validation_error               | 400  | 请求体验证失败              |
| invalid_plan_key               | 400  | Plan 业务标识无效或不存在   |
| invalid_module_key             | 400  | Module 业务标识无效或不存在 |
| invalid_module_dependency      | 400  | 依赖的模块不存在            |
| invalid_admin_api_key          | 401  | Admin API Key 无效          |
| forbidden                      | 403  | 无权限访问该资源            |
| subscription_not_found         | 404  | 订阅不存在                  |
| module_not_found               | 404  | 模块不存在                  |
| plan_not_found                 | 404  | Plan 不存在                 |
| subscription_exists            | 409  | 订阅已存在                  |
| plan_key_exists                | 409  | Plan Key 已存在             |
| plan_version_exists            | 409  | Plan 版本已存在             |
| module_key_exists              | 409  | Module Key 已存在           |
| module_version_exists          | 409  | Module 版本已存在           |
| plan_already_synced            | 409  | Plan 已同步到 Stripe        |
| module_already_synced          | 409  | Module 已同步到 Stripe      |
| stripe_error                   | 502  | Stripe API 错误             |
| plan_not_synced_to_stripe      | 502  | Plan 未同步到 Stripe        |
| module_not_synced_to_stripe    | 502  | Module 未同步到 Stripe      |
| stripe_product_creation_failed | 502  | Stripe Product 创建失败     |
| stripe_price_creation_failed   | 502  | Stripe Price 创建失败       |

---

# 数据库 items 格式

Subscription 表的 `items` 字段存储订阅项的 JSON 数组：

```json
[
  {
    "priceId": "price_basic_plan_xxx",
    "productId": "prod_basic_plan_xxx",
    "planKey": "basic_plan",
    "quantity": 1
  },
  {
    "priceId": "price_appointment_xxx",
    "productId": "prod_appointment_xxx",
    "moduleKey": "appointment",
    "quantity": 1
  },
  {
    "priceId": "price_manager_xxx",
    "productId": "prod_manager_xxx",
    "moduleKey": "manager",
    "quantity": 3
  }
]
```

**字段说明**:

- `priceId`: Stripe Price ID
- `productId`: Stripe Product ID
- `planKey`: Plan 的业务标识（仅 Plan 项有）
- `moduleKey`: Module 的业务标识（仅 Module 项有）
- `quantity`: 数量（Plan 始终为 1，Module 根据 `allowMultiple` 可能大于 1）
