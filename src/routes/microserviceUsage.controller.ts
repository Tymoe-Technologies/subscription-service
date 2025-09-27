import { Router, RequestHandler } from 'express';
import { microserviceUsageController } from '../controllers/microserviceUsage.controller';
import { verifyJwtMiddleware, validateInternalApiKey } from '../middleware/auth';

const router = Router();

// Internal API for recording usage (used by other microservices)
router.post('/record', validateInternalApiKey, microserviceUsageController.recordUsage.bind(microserviceUsageController) as RequestHandler);

// User APIs with JWT authentication
router.get('/stats', verifyJwtMiddleware, microserviceUsageController.getUsageStats.bind(microserviceUsageController) as unknown as RequestHandler);

router.get('/by-service', verifyJwtMiddleware, microserviceUsageController.getUsageByService.bind(microserviceUsageController) as unknown as RequestHandler);

router.get('/trends', verifyJwtMiddleware, microserviceUsageController.getUsageTrends.bind(microserviceUsageController) as unknown as RequestHandler);

router.get('/current/:serviceKey', verifyJwtMiddleware, microserviceUsageController.getCurrentUsage.bind(microserviceUsageController) as unknown as RequestHandler);

export { router as microserviceUsageRoutes };