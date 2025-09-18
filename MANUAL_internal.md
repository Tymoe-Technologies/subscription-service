# Tymoe 订阅服务内部操作手册

> **适用人群**: 内部员工、运维人员、客服团队
> **更新日期**: 2025年9月
> **文档版本**: v1.0

---

## 📋 目录

- [服务概览](#服务概览)
- [常用操作](#常用操作)
- [用户问题处理](#用户问题处理)
- [监控与维护](#监控与维护)
- [紧急情况处理](#紧急情况处理)
- [工具和命令](#工具和命令)

---

## 🌐 服务概览

### 服务基本信息
- **服务名称**: subscription-service
- **服务端口**: 8088
- **部署环境**: https://api.tymoe.com/subscription-service
- **主要功能**: 订阅管理、权限控制、支付处理

### 服务依赖
- **数据库**: PostgreSQL (订阅数据)
- **缓存**: Redis (权限缓存)
- **支付**: Stripe (支付处理)
- **认证**: auth-service (用户验证)

### 服务状态检查
```bash
# 检查服务是否运行
curl https://api.tymoe.com/subscription-service/health

# 预期响应
{
  "status": "ok",
  "service": "subscription-service",
  "version": "1.0.0",
  "timestamp": "2024-01-20T10:30:00Z"
}
```

---

## 🔧 常用操作

### 1. 查看组织订阅状态

**用途**: 了解客户当前的订阅情况

```bash
curl -X GET https://api.tymoe.com/subscription-service/v1/admin/organizations/{组织ID} \
  -H "X-API-Key: ${INTERNAL_API_KEY}"
```

**示例响应**:
```json
{
  "success": true,
  "data": {
    "organization": {
      "id": "org-123",
      "name": "美丽沙龙",
      "hasUsedTrial": true,
      "stripeCustomerId": "cus_stripe123"
    },
    "subscriptions": [
      {
        "id": "sub-456",
        "productKey": "ploml",
        "tier": "basic",
        "status": "active",
        "currentPeriodEnd": "2024-02-15T23:59:59Z"
      }
    ]
  }
}
```

### 2. 为客户创建试用订阅

**用途**: 客服为新客户开启试用

```bash
curl -X POST https://api.tymoe.com/subscription-service/v1/admin/subscriptions/trial \
  -H "X-API-Key: ${INTERNAL_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "organizationId": "org-123",
    "productKey": "ploml",
    "trialDays": 30
  }'
```

### 3. 手动升级客户订阅

**用途**: 处理特殊升级需求

```bash
curl -X PATCH https://api.tymoe.com/subscription-service/v1/admin/subscriptions/{订阅ID}/upgrade \
  -H "X-API-Key: ${INTERNAL_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "newTier": "standard",
    "newBillingCycle": "monthly"
  }'
```

### 4. 查看微服务使用情况

**用途**: 监控客户的API使用量

```bash
curl -X GET https://api.tymoe.com/subscription-service/v1/microservices/stats/{组织ID} \
  -H "Authorization: Bearer ${用户JWT}" \
  -H "X-API-Key: ${INTERNAL_API_KEY}"
```

### 5. 清理过期数据

**用途**: 定期维护，清理过期的并发请求记录

```bash
curl -X POST https://api.tymoe.com/subscription-service/v1/admin/microservices/cleanup-expired \
  -H "X-API-Key: ${INTERNAL_API_KEY}"
```

---

## 🆘 用户问题处理

### 客户反馈处理流程

#### 1. "我无法使用某个功能"

**排查步骤**:
1. 确认客户的组织ID
2. 查看订阅状态
3. 检查功能权限

```bash
# 1. 查看订阅状态
curl -X GET https://api.tymoe.com/subscription-service/v1/admin/organizations/{组织ID} \
  -H "X-API-Key: ${INTERNAL_API_KEY}"

# 2. 检查具体功能权限
curl -X GET https://api.tymoe.com/subscription-service/v1/organizations/{组织ID}/products/{产品}/features/{功能}/access \
  -H "Authorization: Bearer ${客户JWT}"
```

**可能的解决方案**:
- 订阅已过期 → 提醒客户续费
- 功能不在当前套餐内 → 建议升级套餐
- 系统错误 → 查看日志并上报技术团队

#### 2. "支付完成但功能还是不能用"

**排查步骤**:
1. 检查Stripe支付状态
2. 查看Webhook日志
3. 手动同步订阅状态

```bash
# 查看Stripe客户信息
stripe customers retrieve {stripe_customer_id}

# 查看最近的支付
stripe payment_intents list --customer {stripe_customer_id} --limit 5
```

**解决方案**:
如果支付成功但订阅未更新，可手动创建订阅：
```bash
curl -X POST https://api.tymoe.com/subscription-service/v1/admin/subscriptions/paid \
  -H "X-API-Key: ${INTERNAL_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "organizationId": "{组织ID}",
    "productKey": "ploml",
    "tier": "basic",
    "billingCycle": "monthly",
    "stripeSubscriptionId": "{stripe订阅ID}"
  }'
```

#### 3. "API调用次数超限"

**排查步骤**:
1. 查看使用量统计
2. 确认订阅层级限制
3. 检查是否需要升级

```bash
# 查看使用统计
curl -X GET https://api.tymoe.com/subscription-service/v1/microservices/stats/{组织ID} \
  -H "X-API-Key: ${INTERNAL_API_KEY}"
```

**解决方案**:
- 使用量确实超限 → 建议升级套餐
- 错误统计 → 重置使用量记录
- 恶意使用 → 联系技术团队处理

---

## 📊 监控与维护

### 日常监控项目

#### 1. 服务健康状态
```bash
# 每5分钟自动检查
*/5 * * * * curl -f https://api.tymoe.com/subscription-service/health || echo "Service down"
```

#### 2. 数据库连接
```bash
# 检查数据库连接
psql $DATABASE_URL -c "SELECT COUNT(*) FROM Organization;"
```

#### 3. Redis缓存
```bash
# 检查Redis连接
redis-cli -u $REDIS_URL ping
```

#### 4. Stripe Webhook状态
```bash
# 查看最近的webhook事件
stripe events list --limit 10
```

### 定期维护任务

#### 每日任务 (凌晨2点执行)
```bash
# 清理过期的并发请求记录
curl -X POST https://api.tymoe.com/subscription-service/v1/admin/microservices/cleanup-expired \
  -H "X-API-Key: ${INTERNAL_API_KEY}"
```

#### 每周任务 (周日执行)
```bash
# 备份数据库
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql

# 检查订阅过期情况
psql $DATABASE_URL -c "
SELECT organizationId, tier, currentPeriodEnd
FROM Subscription
WHERE currentPeriodEnd < NOW() + INTERVAL '7 days'
AND status = 'active';"
```

#### 每月任务
```bash
# 生成月度使用报告
psql $DATABASE_URL -c "
SELECT
  serviceKey,
  SUM(requestCount) as total_requests,
  COUNT(DISTINCT organizationId) as unique_orgs
FROM MicroserviceUsage
WHERE periodType = 'monthly'
AND usagePeriod = '$(date +%Y-%m)'
GROUP BY serviceKey;"
```

---

## 🚨 紧急情况处理

### 服务宕机处理

#### 1. 立即响应
```bash
# 检查服务状态
curl https://api.tymoe.com/subscription-service/health

# 检查依赖服务
curl https://api.tymoe.com/auth-service/health
psql $DATABASE_URL -c "SELECT 1;"
redis-cli -u $REDIS_URL ping
```

#### 2. 服务重启
```bash
# Docker环境
docker restart subscription-service

# 或 PM2环境
pm2 restart subscription-service
```

#### 3. 回滚操作
```bash
# 如果是部署导致的问题，回滚到上一版本
docker pull subscription-service:last-stable
docker stop subscription-service
docker run -d --name subscription-service subscription-service:last-stable
```

### 数据库问题处理

#### 连接池耗尽
```bash
# 查看活跃连接
psql $DATABASE_URL -c "
SELECT pid, state, query_start, query
FROM pg_stat_activity
WHERE state = 'active';"

# 强制结束长时间运行的查询
psql $DATABASE_URL -c "SELECT pg_terminate_backend({pid});"
```

#### 磁盘空间不足
```bash
# 清理旧日志
find /var/log -name "*.log" -mtime +7 -delete

# 清理过期数据
psql $DATABASE_URL -c "
DELETE FROM MicroserviceUsage
WHERE createdAt < NOW() - INTERVAL '3 months';"
```

### Stripe支付问题

#### Webhook失效
```bash
# 重新配置Webhook
stripe listen --forward-to https://api.tymoe.com/subscription-service/v1/webhooks/stripe

# 手动处理未处理的事件
stripe events retrieve evt_xxx
```

#### 支付失败处理
```bash
# 查看失败的支付
stripe payment_intents list --status requires_payment_method

# 查看客户的订阅状态
stripe subscriptions list --customer cus_xxx
```

---

## 🛠️ 工具和命令

### 环境变量设置
```bash
# 设置API密钥
export INTERNAL_API_KEY="your-internal-api-key"

# 设置数据库连接
export DATABASE_URL="postgresql://user:pass@host:5432/db"

# 设置Redis连接
export REDIS_URL="redis://localhost:6379/1"
```

### 常用查询脚本

#### 查看活跃订阅数量
```sql
SELECT
  tier,
  COUNT(*) as count
FROM Subscription
WHERE status = 'active'
GROUP BY tier;
```

#### 查看试用转化率
```sql
SELECT
  COUNT(CASE WHEN tier = 'trial' THEN 1 END) as trial_count,
  COUNT(CASE WHEN tier != 'trial' THEN 1 END) as paid_count,
  ROUND(
    COUNT(CASE WHEN tier != 'trial' THEN 1 END) * 100.0 /
    NULLIF(COUNT(*), 0), 2
  ) as conversion_rate
FROM Subscription;
```

#### 查看微服务使用Top 10
```sql
SELECT
  organizationId,
  serviceKey,
  SUM(requestCount) as total_requests
FROM MicroserviceUsage
WHERE periodType = 'daily'
AND usagePeriod = CURRENT_DATE::text
GROUP BY organizationId, serviceKey
ORDER BY total_requests DESC
LIMIT 10;
```

### 日志查看命令
```bash
# 查看实时日志
docker logs -f subscription-service

# 查看错误日志
docker logs subscription-service 2>&1 | grep ERROR

# 查看特定时间段日志
docker logs subscription-service --since="2024-01-20T10:00:00" --until="2024-01-20T11:00:00"
```

### 性能监控
```bash
# 查看内存使用
docker stats subscription-service

# 查看数据库性能
psql $DATABASE_URL -c "
SELECT
  query,
  calls,
  total_time,
  mean_time,
  stddev_time
FROM pg_stat_statements
ORDER BY total_time DESC
LIMIT 10;"
```

---

## 📞 联系方式

### 紧急联系
- **技术负责人**: 开发团队负责人
- **运维团队**: 24/7 值班电话
- **业务负责人**: 产品经理

### 上报流程
1. **P0级 (服务完全不可用)**: 立即电话通知技术负责人
2. **P1级 (核心功能异常)**: 30分钟内通过工单系统上报
3. **P2级 (一般问题)**: 工作时间内处理即可

### 文档更新
- 本手册每月更新一次
- 紧急修改后24小时内更新
- 版本历史记录在Git仓库中

---

**最后更新**: 2024年1月20日
**下次更新**: 2024年2月20日
**维护责任人**: 开发团队