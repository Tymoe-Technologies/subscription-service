- 数据库设计更新
erDiagram
    %% ========================================
    %% 第一层：产品目录
    %% ========================================
    modules {
        uuid id PK
        string key UK "模块标识: appointment, member, notification"
        string name "模块名称"
        text description "功能描述"
        string category "core/business/marketing/analytics"
        decimal monthly_price "月费价格(CAD)"
        string pricing_model "fixed/per_usage/hybrid"
        jsonb dependencies "依赖的其他模块keys(预留)"
        string status "ACTIVE/DEPRECATED/SUSPENDED/COMING_SOON"
        timestamp created_at
        timestamp updated_at
    }

    resources {
        uuid id PK
        string type UK "pos/kiosk/tablet/manager/staff"
        string category "device/account"
        string name "资源名称"
        decimal monthly_price "月费价格(CAD)"
        integer standard_quota "Standard Plan包含数量"
        string status "ACTIVE/DEPRECATED"
        timestamp created_at
        timestamp updated_at
    }

    usage_pricing {
        uuid id PK
        string usage_type UK "sms/api_call"
        string display_name "显示名称"
        decimal unit_price "单价(CAD)"
        string currency "CAD"
        boolean is_active "是否启用"
        timestamp created_at
        timestamp updated_at
    }

    standard_plan {
        uuid id PK
        string name "Standard Plan名称"
        string version "版本号,如v1.0,v2.0"
        text description "版本描述"
        decimal monthly_price "基础价格(CAD) 199.00"
        jsonb included_module_keys "包含的模块keys数组"
        jsonb resource_quotas "资源配额JSON:{pos:2,kiosk:1,...}"
        integer trial_duration_days "试用期天数 30"
        integer trial_sms_quota "试用期免费短信数 100"
        string status "ACTIVE/ARCHIVED/DELETED"
        timestamp activated_at "激活时间"
        timestamp archived_at "归档时间"
        timestamp deleted_at "删除时间"
        string deleted_by "删除操作人"
        string created_by "创建人"
        timestamp created_at
        timestamp updated_at
    }

    %% ========================================
    %% 第二层：客户订阅
    %% ========================================
    subscriptions {
        uuid id PK
        uuid org_id UK "组织ID(来自auth-service accesstoken中的orgId)"
        uuid payer_id "付款人ID(来自auth-service accesstoken中的userId)"
        string billing_cycle "monthly"
        timestamp started_at "订阅开始时间"
        timestamp renews_at "下次续费时间"
        timestamp trial_ends_at "试用期结束时间"
        string status "TRIAL/ACTIVE/EXPIRED/SUSPENDED/CANCELLED"
        boolean auto_renew "是否自动续费"
        decimal standard_price "Standard价格(CAD)"
        integer trial_sms_used "Trial已用短信数"
        boolean trial_sms_enabled "Trial短信是否启用"
        decimal sms_monthly_budget "短信月预算(CAD,null=无限)"
        decimal sms_current_spending "本月短信已花费(CAD)"
        jsonb sms_budget_alerts "已发警告:['50','95']"
        boolean sms_notify_by_email "预算警告用邮件"
        boolean sms_notify_by_sms "预算警告用短信"
        timestamp grace_period_ends_at "宽限期结束时间(7天)"
        boolean grace_alert_sent "是否已发首次警告"
        string payment_provider "stripe/paypal"
        string provider_customer_id "支付商客户ID"
        jsonb provider_metadata "支付商元数据"
        string payment_last4 "支付方式后4位"
        timestamp cancelled_at
        text cancel_reason
        timestamp created_at
        timestamp updated_at
    }

    subscription_modules {
        uuid id PK
        uuid subscription_id FK
        uuid module_id FK
        boolean is_active "是否启用"
        timestamp added_at "添加时间(按天计费)"
        timestamp removed_at "移除时间(用到期末)"
        timestamp created_at
        timestamp updated_at
        unique subscription_id_module_id
    }

    subscription_resources {
        uuid id PK
        uuid subscription_id FK
        uuid resource_id FK
        integer quantity "购买数量(额外购买)"
        timestamp added_at "添加时间(按天计费)"
        timestamp removed_at "移除时间"
        timestamp created_at
        timestamp updated_at
        unique subscription_id_resource_id
    }

    suspended_resources {
        uuid id PK
        uuid subscription_id FK
        string resource_type "device/account"
        string resource_subtype "pos/kiosk/tablet/manager/staff"
        uuid resource_target_id "设备ID或账号ID(来自auth-service)"
        timestamp suspended_at "暂停时间"
        timestamp grace_expires_at "宽限期结束(30天后)"
        string reason "DOWNGRADE/PAYMENT_FAILED/MANUAL"
        timestamp restored_at "恢复时间(null=未恢复)"
        timestamp created_at
    }

    %% ========================================
    %% 第三层：计费结算
    %% ========================================
    usages {
        uuid id PK
        uuid subscription_id FK
        uuid module_id FK
        string usage_type "sms/api_call(对应usage_pricing)"
        integer quantity "使用数量"
        decimal unit_price "单价(CAD)"
        decimal amount "总金额(CAD)"
        boolean is_free "是否免费(Trial额度内)"
        jsonb metadata "详细信息"
        string provider_record_id "支付商记录ID"
        timestamp billed_at "计入账单时间(null=未结算)"
        uuid invoice_id FK
        timestamp created_at
    }

    invoices {
        uuid id PK
        uuid subscription_id FK
        timestamp period_start "账单周期开始"
        timestamp period_end "账单周期结束"
        jsonb items "账单明细JSON"
        decimal subtotal "小计(CAD)"
        decimal discount "折扣(CAD)"
        decimal tax "税费(CAD,Stripe自动计算)"
        decimal total "总计(CAD)"
        string status "PENDING/PAID/FAILED/REFUNDED"
        timestamp paid_at "支付时间"
        string payment_provider "stripe/paypal"
        string provider_invoice_id "支付商账单ID"
        jsonb provider_metadata "支付商元数据(含税费详情)"
        text failure_reason "失败原因"
        integer retry_count "重试次数"
        timestamp next_retry_at "下次重试时间"
        string number UK "发票号:INV-2025-01-001"
        string pdf_url "PDF下载链接"
        timestamp created_at
        timestamp updated_at
    }

    payment_methods {
        uuid id PK
        uuid user_id "用户ID(来自auth-service)"
        string provider "stripe/paypal"
        string provider_method_id "支付商方法ID"
        jsonb provider_metadata "支付商元数据"
        string brand "visa/mastercard"
        string last4 "后4位"
        date expires_at "过期日期"
        boolean is_default "是否默认"
        boolean is_active "是否有效"
        timestamp created_at
        timestamp updated_at
    }

    subscription_logs {
        uuid id PK
        uuid subscription_id FK
        string action "操作类型"
        uuid actor_id "操作人ID"
        jsonb details "详细信息"
        timestamp created_at
    }

    %% ========================================
    %% 关系定义
    %% ========================================
    
    subscriptions ||--o{ subscription_modules : "包含"
    subscriptions ||--o{ subscription_resources : "包含"
    subscriptions ||--o{ suspended_resources : "暂停资源"
    subscriptions ||--o{ usages : "产生"
    subscriptions ||--o{ invoices : "生成"
    subscriptions ||--o{ subscription_logs : "记录"
    
    modules ||--o{ subscription_modules : "被订阅"
    modules ||--o{ usages : "产生使用量"
    
    resources ||--o{ subscription_resources : "被购买"
    
    usage_pricing ||--o{ usages : "定价参考"
    
    invoices ||--o{ usages : "包含使用量"

---

## API开发计划

### Part 1: 管理员API - 产品目录管理

#### Phase 1: 模块管理 ✅ (已完成开发)
- 创建模块 `POST /admin/modules`
- 列出所有模块 `GET /admin/modules`
- 查询单个模块 `GET /admin/modules/:id`
- 更新模块 `PATCH /admin/modules/:id`
- 删除模块 `DELETE /admin/modules/:id`
- 更新模块状态 `PATCH /admin/modules/:id/status`

#### Phase 2: 资源管理 ✅ (已完成开发)
- 管理资源定价(POS/Kiosk/Tablet/Manager/Staff)
- 6个端点 (CRUD + 状态管理)
- 已实现端点:
  - `POST /admin/resources` - 创建资源
  - `GET /admin/resources` - 列出所有资源(分页、筛选、排序)
  - `GET /admin/resources/:id` - 查询单个资源
  - `PATCH /admin/resources/:id` - 更新资源
  - `DELETE /admin/resources/:id` - 删除资源(软删除)
  - `PATCH /admin/resources/:id/status` - 更新资源状态

#### Phase 3: 按量计费管理 ✅ (已完成开发)
- 管理SMS/API Call等按量计费规则
- 5个端点 (CRUD + 启用/禁用)
- 已实现端点:
  - `POST /admin/usage-pricing` - 创建按量计费规则
  - `GET /admin/usage-pricing` - 列出所有按量计费规则(分页、筛选、排序)
  - `GET /admin/usage-pricing/:id` - 查询单个按量计费规则
  - `PATCH /admin/usage-pricing/:id` - 更新按量计费规则
  - `PATCH /admin/usage-pricing/:id/status` - 更新按量计费规则状态(启用/禁用)
- 特性:
  - 使用boolean类型的isActive字段(而非Enum)
  - 支持4位小数精度的unitPrice
  - usageType作为唯一标识
  - 禁用时检查未结算使用记录并提供警告
  - 不提供DELETE端点,只能通过禁用来停止使用

#### Phase 4: Standard Plan管理 ✅ (已完成开发)
- 管理Standard Plan配置的多版本管理
- 7个端点 (创建、查询ACTIVE、列出、查询、更新、激活、删除)
- 已实现端点:
  - `POST /admin/standard-plan` - 创建Standard Plan版本
  - `GET /admin/standard-plan` - 查询当前ACTIVE的Standard Plan
  - `GET /admin/standard-plan/list` - 列出所有Standard Plan版本(分页、筛选、排序)
  - `GET /admin/standard-plan/:id` - 查询单个Standard Plan版本
  - `PATCH /admin/standard-plan/:id` - 更新Standard Plan版本
  - `PATCH /admin/standard-plan/:id/activate` - 激活ARCHIVED版本
  - `DELETE /admin/standard-plan/:id` - 软删除Standard Plan版本
- 特性:
  - 支持多版本管理：ACTIVE(当前生效)、ARCHIVED(历史版本)、DELETED(已删除)
  - 事务激活机制：激活新版本时自动归档旧版本，确保同时只有一个ACTIVE版本
  - 引用完整性验证：自动检查包含的模块keys和资源配额的有效性
  - 软删除设计：仅可删除ARCHIVED状态版本，ACTIVE版本需先激活其他版本
  - 创建时支持activateImmediately选项立即激活
  - 更新ACTIVE版本时检查活跃订阅数量并返回警告
  - 包含配置：月费价格、包含模块keys、资源配额(5种类型)、试用期天数、试用期短信配额

#### Phase 5: 订阅统计查询 ✅ (已完成开发)
- 管理员查看订阅统计和订阅列表
- 2个端点 (统计、列表查询)
- 已实现端点:
  - `GET /admin/statistics` - 获取全局订阅统计数据
  - `GET /admin/subscriptions/list` - 列出订阅（分页、筛选、排序）
- 特性:
  - 全局统计：订阅概览、收入指标(MRR/ARPU)、转化率、趋势分析
  - 支付健康度：发票统计、支付成功率分析
  - 资源使用统计：模块和资源订阅统计
  - 列表查询：支持多维度筛选（状态、时间范围、价格范围、支付方式）
  - 详细摘要：订阅详情包含模块摘要、资源摘要、使用量统计、最近发票
  - 统计时间范围：支持自定义from/to参数，默认统计本月数据
  - 订阅列表排序：支持按创建时间、续费时间、价格、状态、试用结束时间排序

### Part 2: 订阅管理API ✅ (已完成开发)
调用者: 前端用户
鉴权: JWT Token (仅允许 `userType === "USER"`)
基础路径: `/api/subscription-service/v1/subscriptions`
**说明**: ACCOUNT类型（Owner/Manager/Staff）不能调用这些API

#### 已完成实现 (11个端点)
1. `POST /subscriptions/trial` - 创建Trial订阅 ✅
2. `POST /subscriptions/activate` - 激活订阅（Trial转正式 OR 跳过Trial直接订阅） ✅
3. `POST /subscriptions/modules` - 添加可选模块 ✅
4. `DELETE /subscriptions/modules/:moduleKey` - 移除模块（月底生效） ✅
5. `POST /subscriptions/resources` - 购买额外资源 ✅
6. `DELETE /subscriptions/resources/:resourceType` - 释放资源 ✅
7. `POST /subscriptions/downgrade` - 批量减配资源 ✅
8. `POST /subscriptions/cancel` - 取消订阅（月底生效，不退款） ✅
9. `POST /subscriptions/reactivate` - 重新激活订阅 ✅
10. `PUT /subscriptions/payment-method` - 更新支付方式 ✅
11. `PUT /subscriptions/sms-budget` - 更新短信预算 ✅

#### 核心特性
- **双场景激活**: Trial转正式 + 跳过Trial直接订阅
- **Billing Anchor Day**: 智能处理月份天数差异（参考Stripe）
- **按天计费**: 添加模块/资源时精确计算剩余天数费用
- **月底生效**: 取消/移除操作不立即生效，用户体验更好
- **完全恢复**: 重新激活时恢复所有之前的配置和价格
- **枚举化取消原因**: 8种常见原因 + OTHER可选填
- **宽限期机制**: 释放资源时30天选择期

#### 已完成模块
- ✅ 类型定义 (`src/types/index.ts`): CancelReason枚举、ActivationType、ResourceType
- ✅ 中间件 (`src/middleware/auth.ts`): requireUserType验证
- ✅ 验证器 (`src/validators/subscription.validators.ts`): 所有11个端点的Zod schema
- ✅ Service层 (`src/services/subscription.service.ts`): 核心业务逻辑（所有11个方法，约1800行代码）
- ✅ Controller层 (`src/controllers/subscriptionManagement.controller.ts`): HTTP请求处理（11个方法，324行）
- ✅ Routes层 (`src/routes/subscriptionManagement.routes.ts`): 路由定义（11个端点，148行）
- ✅ 应用集成 (`src/app.ts`): 挂载到 `/subscriptions` 路径
- ✅ API文档 (`API.md`): Part 2完整文档（包含所有11个API）

#### 待完善功能
- ✅ Stripe集成: 已完成真实API集成（沙盒环境），使用stripeService调用Stripe API
- ⏳ Auth-service集成: 释放资源时的设备/账号暂停逻辑
- ⏳ 测试: 单元测试、集成测试、E2E测试

**详细设计文档**: 见 `PART2_IMPLEMENTATION.md`

### Part 3: 查询API ✅ (已完成开发)
调用者: 前端用户
鉴权: JWT Token (仅允许 `userType === "USER"`)
基础路径: `/api/subscription-service/v1/queries`

#### 已完成实现 (8个端点)
1. `GET /queries/subscription` - 查询当前订阅详情 ✅
2. `GET /queries/invoices` - 查询账单历史（分页、筛选） ✅
3. `GET /queries/invoices/:invoiceId` - 查询单个发票详情 ✅
4. `GET /queries/usage` - 查询使用量明细（分页、筛选） ✅
5. `GET /queries/usage/summary` - 查询使用量统计汇总 ✅
6. `GET /queries/preview-activation` - 预览激活后费用 ✅
7. `GET /queries/quotas` - 查询可用配额和使用情况 ✅
8. `GET /queries/logs` - 查询订阅日志（分页） ✅

#### 核心特性
- **完全只读**: 所有API都是GET请求，不修改任何数据
- **权限隔离**: 用户只能查询自己组织的数据
- **分页支持**: 防止大量数据加载
- **多维度筛选**: 支持状态、时间范围、类型等筛选
- **实时计算**: 配额使用率、费用统计等实时计算
- **关联查询优化**: 使用Prisma的include优化，避免N+1问题

#### 已完成模块
- ✅ 验证器 (`src/validators/query.validators.ts`): 所有8个端点的Zod schema
- ✅ Service层 (`src/services/query.service.ts`): 查询业务逻辑（8个方法）
- ✅ Controller层 (`src/controllers/query.controller.ts`): HTTP请求处理（8个方法）
- ✅ Routes层 (`src/routes/query.routes.ts`): 路由定义
- ✅ 应用集成 (`src/app.ts`): 挂载到 `/queries` 路径
- ✅ API文档 (`API.md`): Part 3完整文档

#### 待完善功能
- ⏳ Auth-service集成: API 7配额查询的currentUsage需要从auth-service实时获取
- ⏳ 性能优化: 考虑添加缓存（Redis）
- ⏳ 导出功能: 账单PDF导出、使用量CSV导出

**详细设计文档**: 见 `PART3_IMPLEMENTATION.md`

### Part 4: 内部API ✅ (已完成开发)
调用者: auth-service、notification-service等微服务
鉴权: Service API Key (`X-API-Key` header)
基础路径: `/api/subscription-service/v1/internal`

#### 已完成实现 (7个端点)
1. `POST /internal/quota/check` - 检查资源配额（auth-service创建设备/账号前） ✅
2. `POST /internal/access/check` - 检查访问权限（auth-service登录时） ✅
3. `POST /internal/resources/suspend` - 暂停资源 ✅
4. `POST /internal/resources/restore` - 恢复资源 ✅
5. `POST /internal/usage/record` - 记录使用量（notification-service发送SMS后） ✅
6. `POST /internal/usage/batch` - 批量记录使用量 ✅
7. `POST /internal/stats/active-resources` - 统计活跃资源（auth-service定期同步） ✅

#### 核心特性
- **快速响应**: 目标响应时间 < 100ms（关键登录路径）
- **幂等性**: 使用providerRecordId避免重复计费
- **宽限期机制**: 30天宽限期，避免立即中断服务
- **实时同步**: auth-service定期同步实际使用量
- **预算警告**: 多阈值预算警告（50%, 80%, 95%, 100%）
- **灵活配额**: 基础配额 + 额外购买的灵活计算

#### 已完成模块
- ✅ 验证器 (`src/validators/internal.validators.ts`): 所有7个端点的Zod schema
- ✅ Service层 (`src/services/internal.service.ts`): 内部API业务逻辑（7个方法）
- ✅ Controller层 (`src/controllers/internal.controller.ts`): HTTP请求处理（7个方法）
- ✅ Routes层 (`src/routes/internal.routes.ts`): 路由定义
- ✅ 应用集成 (`src/app.ts`): 挂载到 `/internal` 路径
- ✅ API文档 (`API.md`): Part 4完整文档

#### 待完善功能
- ⏳ Redis缓存: 缓存配额信息和使用量数据
- ⏳ 性能优化: 数据库索引优化、响应时间监控
- ⏳ 监控告警: API调用监控、配额超限告警、预算超限告警

**详细设计文档**: 见 `PART4_IMPLEMENTATION.md`

### Part 5: Webhook API ✅ (已完成开发)
调用者: Stripe/PayPal等支付商
鉴权: Webhook签名验证
基础路径: `/api/subscription-service/v1/webhooks`

#### 已完成实现 (12个事件类型)

##### 订阅生命周期（4个）
1. `checkout.session.completed` - 结账完成（Trial转正式） ✅
2. `customer.subscription.created` - 订阅创建 ✅
3. `customer.subscription.updated` - 订阅更新（续费/升级） ✅
4. `customer.subscription.deleted` - 订阅删除 ✅

##### 发票和支付（4个）
5. `invoice.created` - 发票创建 ✅
6. `invoice.finalized` - 发票确定 ✅
7. `invoice.payment_succeeded` - 支付成功 ✅
8. `invoice.payment_failed` - 支付失败 ✅

##### 支付方式（2个）
9. `payment_method.attached` - 支付方式绑定 ✅
10. `payment_method.detached` - 支付方式解绑 ✅

##### 其他（2个）
11. `charge.refunded` - 退款 ✅
12. `customer.updated` - 客户更新 ✅

#### 核心特性
- **签名验证**: Stripe Signature验证，确保请求来源可信
- **幂等性保证**: 数据库去重，防止重复处理（业界最佳实践）
- **异步处理**: 快速响应200，后台处理事件
- **完整日志**: 记录所有事件用于审计追踪
- **月度续费重置**: 自动重置短信花费和预算警告
- **宽限期机制**: 支付失败后7天宽限期
- **发票号生成**: 人类友好格式（INV-YYYY-MM-###）

#### 已完成模块
- ✅ 数据库Schema (`prisma/schema.prisma`): 新增WebhookEvent表（通用设计，支持多支付商）
- ✅ Service层 (`src/services/webhook.service.ts`): 12个事件处理器
- ✅ Controller层 (`src/controllers/webhook.controller.ts`): HTTP处理器
- ✅ Routes层 (`src/routes/webhook.routes.ts`): 路由定义
- ✅ 应用集成 (`src/app.ts`): 挂载webhook路由
- ✅ API文档 (`API.md`): Part 5完整文档

#### 待完善功能
- ⏳ PayPal Webhook支持: 添加PayPal IPN处理
- ⏳ 监控告警: Webhook处理成功率监控、失败告警
- ⏳ 自动化测试: 单元测试、集成测试、幂等性测试
- ⏳ 重放功能: 利用payload字段实现事件重放

**详细设计文档**: 见 `PART5_IMPLEMENTATION.md`
- 你不可以npm run dev我的服务,你修改完告诉我,我自己手动来测试.