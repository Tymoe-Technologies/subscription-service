// src/utils/logger.ts
import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = isDev
  ? pino(
      {
        level: process.env.LOG_LEVEL ?? 'info',
        base: {
          service: 'subscription-service',
          environment: process.env.NODE_ENV ?? 'development',
        },
        timestamp: pino.stdTimeFunctions.isoTime,
        formatters: {
          level: label => ({ level: label }),
        },
      },
      pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      })
    )
  : pino({
      level: process.env.LOG_LEVEL ?? 'info',
      base: {
        service: 'subscription-service',
        environment: process.env.NODE_ENV ?? 'development',
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: label => ({ level: label }),
      },
    });

export default logger;
