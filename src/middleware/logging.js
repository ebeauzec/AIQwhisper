/**
 * @module middleware/logging
 * @description Express request-logging middleware.
 * Logs every request with method, URL, HTTP status, and response time.
 * Log level is chosen by status code range:
 *   - 2xx / 3xx → info
 *   - 4xx       → warn
 *   - 5xx       → error
 */

'use strict';

const logger = require('../utils/logger');

/**
 * Create the request-logging middleware.
 *
 * Captures the start time via `process.hrtime.bigint()` and hooks into
 * the response `finish` event to log the completed request.
 *
 * @returns {import('express').RequestHandler}
 *
 * @example
 *   const express = require('express');
 *   const requestLogger = require('./middleware/logging');
 *   const app = express();
 *   app.use(requestLogger());
 */
function requestLogger() {
  /**
   * @param {import('express').Request}      req
   * @param {import('express').Response}     res
   * @param {import('express').NextFunction} next
   */
  return (req, res, next) => {
    const startNs = process.hrtime.bigint();

    res.on('finish', () => {
      const durationNs = process.hrtime.bigint() - startNs;
      const durationMs = Number(durationNs / 1_000_000n);
      const { method } = req;
      const url = req.originalUrl || req.url;
      const { statusCode } = res;

      const message = `${method} ${url} ${statusCode} ${durationMs}ms`;

      if (statusCode >= 500) {
        logger.error(message);
      } else if (statusCode >= 400) {
        logger.warn(message);
      } else {
        logger.info(message);
      }
    });

    next();
  };
}

module.exports = requestLogger;
