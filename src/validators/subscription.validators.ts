import { z } from 'zod';
import { CancelReason } from '../types/index.js';

/**
 * Part 2: 订阅管理API - Zod验证Schema
 */

// ========================================
// API 1: POST /subscriptions/trial
// ========================================
// 批量创建Trial订阅（仅支持MAIN类型店铺）
// 支持两种格式：
// 1. 旧格式（向后兼容）: { organizationIds: string[] }
// 2. 新格式（自定义配置）: { items: [{organizationId, additionalModules?, additionalResources?}] }

// 自定义资源配置
const SubscriptionResourceSchema = z.object({
  resourceType: z.enum(['pos', 'kiosk', 'tablet', 'manager', 'staff'], {
    errorMap: () => ({
      message: 'Resource type must be one of: pos, kiosk, tablet, manager, staff',
    }),
  }),
  quantity: z.number().int().min(1, 'Quantity must be at least 1'),
});

// 新格式：单个订阅配置项
const SubscriptionItemSchema = z.object({
  organizationId: z.string().uuid('Organization ID must be a valid UUID'),
  additionalModules: z
    .array(z.string().min(1, 'Module key cannot be empty'))
    .optional()
    .default([]),
  additionalResources: z.array(SubscriptionResourceSchema).optional().default([]),
});

// 旧格式（向后兼容）
const LegacyCreateTrialSchema = z.object({
  organizationIds: z
    .array(z.string().uuid('Each organization ID must be a valid UUID'))
    .min(1, 'At least one organization ID is required')
    .max(20, 'Maximum 20 organizations allowed per request'),
});

// 新格式（自定义配置）
const NewCreateTrialSchema = z.object({
  items: z
    .array(SubscriptionItemSchema)
    .min(1, 'At least one item is required')
    .max(20, 'Maximum 20 items allowed per request'),
});

// 联合类型：支持两种格式
export const CreateTrialSubscriptionSchema = z.union([
  LegacyCreateTrialSchema,
  NewCreateTrialSchema,
]);

export type CreateTrialSubscriptionRequest = z.infer<typeof CreateTrialSubscriptionSchema>;
export type SubscriptionItem = z.infer<typeof SubscriptionItemSchema>;

// ========================================
// API 2: POST /subscriptions/activate
// ========================================
// 激活Trial订阅，转为正式订阅（仅MAIN店）
// 返回Stripe Checkout URL供用户跳转支付
// 支付成功/取消后统一跳转到User控制台（由.env配置）
export const ActivateSubscriptionSchema = z.object({
  organizationId: z.string().uuid('Organization ID must be a valid UUID'),
});
export type ActivateSubscriptionRequest = z.infer<typeof ActivateSubscriptionSchema>;

// ========================================
// 新增 API: POST /subscriptions/calculate
// ========================================
// 价格计算API - 实时预览订阅费用
// 与创建Trial使用相同的items格式
export const CalculatePriceSchema = z.object({
  items: z
    .array(SubscriptionItemSchema)
    .min(1, 'At least one item is required')
    .max(20, 'Maximum 20 items allowed per request'),
  couponCode: z.string().optional(), // TODO: 优惠券功能待实现
  billingCycle: z.enum(['monthly', 'yearly']).optional().default('monthly'),
});

export type CalculatePriceRequest = z.infer<typeof CalculatePriceSchema>;

// ========================================
// API 8: POST /subscriptions/cancel
// ========================================
export const CancelSubscriptionSchema = z
  .object({
    organizationId: z.string().uuid('Organization ID must be a valid UUID'),
    reason: z.nativeEnum(CancelReason, {
      errorMap: () => ({ message: 'Invalid cancel reason' }),
    }),
    otherReason: z.string().max(500).optional(),
  })
  .refine(
    (data) => {
      // 如果reason是OTHER，建议提供otherReason（但不强制）
      return true;
    },
    {
      message: 'When reason is OTHER, providing otherReason is recommended',
    }
  );
export type CancelSubscriptionRequest = z.infer<typeof CancelSubscriptionSchema>;

// ========================================
// API 9: POST /subscriptions/reactivate
// ========================================
export const ReactivateSubscriptionSchema = z.object({
  organizationId: z.string().uuid('Organization ID must be a valid UUID'),
});
export type ReactivateSubscriptionRequest = z.infer<typeof ReactivateSubscriptionSchema>;

// ========================================
// API 10: PUT /subscriptions/payment-method
// ========================================
// 创建Stripe Billing Portal Session供用户跳转管理支付方式
// 支付方式by user，不需要指定organizationId，returnUrl使用环境变量
export const UpdatePaymentMethodSchema = z.object({});
export type UpdatePaymentMethodRequest = z.infer<typeof UpdatePaymentMethodSchema>;

// ========================================
// API 11: PUT /subscriptions/sms-budget
// ========================================
export const UpdateSmsBudgetSchema = z.object({
  organizationId: z.string().uuid('Organization ID must be a valid UUID'),
  monthlyBudget: z
    .number()
    .positive('Monthly budget must be positive')
    .nullable()
    .optional(),
  alerts: z
    .array(z.number().int().min(0).max(100, 'Alert threshold must be between 0-100'))
    .optional(),
  notifyByEmail: z.boolean().optional(),
  notifyBySms: z.boolean().optional(),
});
export type UpdateSmsBudgetRequest = z.infer<typeof UpdateSmsBudgetSchema>;

// API 7: 添加模块到订阅
export const AddModuleToSubscriptionSchema = z.object({
  organizationId: z.string().uuid('Organization ID must be a valid UUID'),
  moduleKey: z.string().min(1, 'Module key is required').max(50),
});
export type AddModuleToSubscriptionRequest = z.infer<typeof AddModuleToSubscriptionSchema>;

// API 8: 添加资源到订阅
export const AddResourceToSubscriptionSchema = z.object({
  organizationId: z.string().uuid('Organization ID must be a valid UUID'),
  resourceKey: z.string().min(1, 'Resource key is required').max(50),
  quantity: z.number().int().min(1, 'Quantity must be at least 1'),
});
export type AddResourceToSubscriptionRequest = z.infer<typeof AddResourceToSubscriptionSchema>;
