import { Router } from 'express';
import modulesRoutes from './modules.routes.js';
import resourcesRoutes from './resources.routes.js';
import usagePricingRoutes from './usagePricing.routes.js';
import standardPlanRoutes from './standardPlan.routes.js';
import subscriptionStatisticsRoutes from './subscriptionStatistics.routes.js';

const router = Router();

// 挂载模块管理路由
router.use('/modules', modulesRoutes);

// 挂载资源管理路由
router.use('/resources', resourcesRoutes);

// 挂载按量计费管理路由
router.use('/usage-pricing', usagePricingRoutes);

// 挂载Standard Plan管理路由
router.use('/standard-plan', standardPlanRoutes);

// 挂载订阅统计查询路由
router.use('/', subscriptionStatisticsRoutes);

export default router;
