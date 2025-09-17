import { startServer } from './server.js';
import { service } from './config/config.js';
import { logger } from './utils/logger.js';

/**
 * Main application entry point
 */
async function main() {
  try {
    logger.info('Starting Subscription Service', {
      environment: service.nodeEnv,
      port: service.port,
      timestamp: new Date().toISOString(),
    });

    // Start the server
    await startServer(service.port);

  } catch (error) {
    logger.error('Failed to start application', {
      error: error instanceof Error ? error instanceof Error ? error.message : String(error) : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', {
    error: error instanceof Error ? error.message : String(error),
    stack: error.stack,
  });
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
    promise: promise.toString(),
  });
  process.exit(1);
});

// Start the application
main().catch((error) => {
  logger.error('Application startup failed', {
    error: error instanceof Error ? error instanceof Error ? error.message : String(error) : 'Unknown error',
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
