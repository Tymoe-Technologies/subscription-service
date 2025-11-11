import { Router } from 'express';
import { subscriptionManagementController } from '../controllers/subscriptionManagement.controller.js';
import { verifyJwtMiddleware, requireUserType } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  CreateTrialSubscriptionSchema,
  CalculatePriceSchema,
  ActivateSubscriptionSchema,
  CancelSubscriptionSchema,
  ReactivateSubscriptionSchema,
  UpdatePaymentMethodSchema,
  UpdateSmsBudgetSchema,
  AddModuleToSubscriptionSchema,
  AddResourceToSubscriptionSchema,
} from '../validators/subscription.validators.js';

const router = Router();

/**
 * @route   POST /api/subscription-service/v1/subscriptions/calculate
 * @desc    计算订阅价格（无需JWT，公开API）
 * @access  Public
 */
router.post(
  '/calculate',
  validate(CalculatePriceSchema, 'body'),
  subscriptionManagementController.calculatePrice.bind(subscriptionManagementController)
);

// 以下路由都需要JWT验证和USER类型验证
router.use(verifyJwtMiddleware);
router.use(requireUserType);

/**
 * @route   POST /api/subscription-service/v1/subscriptions/subscribe
 * @desc    创建订阅（智能检测：首次订阅→Trial，重复订阅→Active）
 * @access  User (JWT Token, userType=USER)
 */
router.post(
  '/subscribe',
  validate(CreateTrialSubscriptionSchema, 'body'),
  subscriptionManagementController.createTrial.bind(subscriptionManagementController)
);

/**
 * @route   POST /api/subscription-service/v1/subscriptions/activate
 * @desc    激活订阅（Trial转正式 OR 跳过Trial直接订阅）
 * @access  User (JWT Token, userType=USER)
 */
router.post(
  '/activate',
  validate(ActivateSubscriptionSchema, 'body'),
  subscriptionManagementController.activateSubscription.bind(subscriptionManagementController)
);

/**
 * @route   POST /api/subscription-service/v1/subscriptions/cancel
 * @desc    取消订阅（月底生效，不退款）
 * @access  User (JWT Token, userType=USER)
 */
router.post(
  '/cancel',
  validate(CancelSubscriptionSchema, 'body'),
  subscriptionManagementController.cancelSubscription.bind(subscriptionManagementController)
);

/**
 * @route   POST /api/subscription-service/v1/subscriptions/reactivate
 * @desc    重新激活订阅
 * @access  User (JWT Token, userType=USER)
 */
router.post(
  '/reactivate',
  validate(ReactivateSubscriptionSchema, 'body'),
  subscriptionManagementController.reactivateSubscription.bind(subscriptionManagementController)
);

/**
 * @route   PUT /api/subscription-service/v1/subscriptions/payment-method
 * @desc    更新支付方式
 * @access  User (JWT Token, userType=USER)
 */
router.put(
  '/payment-method',
  validate(UpdatePaymentMethodSchema, 'body'),
  subscriptionManagementController.updatePaymentMethod.bind(subscriptionManagementController)
);

/**
 * @route   PUT /api/subscription-service/v1/subscriptions/sms-budget
 * @desc    更新短信预算
 * @access  User (JWT Token, userType=USER)
 */
router.put(
  '/sms-budget',
  validate(UpdateSmsBudgetSchema, 'body'),
  subscriptionManagementController.updateSmsBudget.bind(subscriptionManagementController)
);

/**
 * @route   POST /api/subscription-service/v1/subscriptions/modules
 * @desc    添加模块到订阅
 * @access  User (JWT Token, userType=USER)
 */
router.post(
  '/modules',
  validate(AddModuleToSubscriptionSchema, 'body'),
  subscriptionManagementController.addModuleToSubscription.bind(subscriptionManagementController)
);

/**
 * @route   POST /api/subscription-service/v1/subscriptions/resources
 * @desc    添加资源到订阅
 * @access  User (JWT Token, userType=USER)
 */
router.post(
  '/resources',
  validate(AddResourceToSubscriptionSchema, 'body'),
  subscriptionManagementController.addResourceToSubscription.bind(subscriptionManagementController)
);

export default router;
