/**
 * @module utils/logger
 * @description Winston logger configured with a colorized console transport.
 * Output format: [YYYY-MM-DD HH:mm:ss] [LEVEL] message
 */

'use strict';

const { createLogger, format, transports } = require('winston');
const config = require('../config');

/**
 * Custom printf format that produces:
 *   [2026-07-15 12:00:00] [INFO] Some log message
 */
const logFormat = format.printf(({ level, message, timestamp, stack, ...meta }) => {
  const tag = `[${timestamp}] [${level.toUpperCase()}]`;
  const body = stack || message;
  const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${tag} ${body}${extra}`;
});

/**
 * Winston logger instance.
 *
 * @type {import('winston').Logger}
 * @example
 *   const logger = require('./utils/logger');
 *   logger.info('Server started on port %d', 3000);
 */
const logger = createLogger({
  level: config.logLevel,
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    logFormat
  ),
  transports: [
    new transports.Console({
      format: format.combine(
        format.colorize({ level: true }),
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        format.errors({ stack: true }),
        logFormat
      ),
    }),
  ],
  // Prevent winston from exiting on uncaught exceptions
  exitOnError: false,
});

module.exports = logger;
