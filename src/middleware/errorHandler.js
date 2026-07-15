/**
 * @module middleware/errorHandler
 * @description Global Express error-handling middleware.
 * Returns a consistent JSON envelope and logs errors via Winston.
 *
 * Response shape:
 * ```json
 * {
 *   "error": {
 *     "code": "VALIDATION_ERROR",
 *     "message": "Human-readable message",
 *     "details": { ... }            // optional
 *   }
 * }
 * ```
 */

'use strict';

const logger = require('../utils/logger');

/**
 * Known application error codes mapped to HTTP status codes.
 * Throw an Error with a `.code` property matching one of these keys
 * to get the corresponding status.
 *
 * @type {Object<string, number>}
 */
const ERROR_STATUS_MAP = {
  VALIDATION_ERROR: 400,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  GONE: 410,
  UNPROCESSABLE_ENTITY: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  SERVICE_UNAVAILABLE: 503,
};

/**
 * Create the global error-handling middleware.
 *
 * @returns {import('express').ErrorRequestHandler}
 *
 * @example
 *   const express = require('express');
 *   const errorHandler = require('./middleware/errorHandler');
 *   const app = express();
 *   // ... routes ...
 *   app.use(errorHandler());
 */
function errorHandler() {
  /**
   * Express error handler (4-arg signature).
   *
   * @param {Error & { code?: string, statusCode?: number, details?: * }} err
   * @param {import('express').Request}      req
   * @param {import('express').Response}     res
   * @param {import('express').NextFunction} _next
   */
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, _next) => {
    // Determine HTTP status
    let status = err.statusCode || ERROR_STATUS_MAP[err.code] || 500;

    // Normalise error code
    const code = err.code || (status < 500 ? 'BAD_REQUEST' : 'INTERNAL_ERROR');
    const message = err.expose !== false && err.message
      ? err.message
      : 'An unexpected error occurred';

    // Build response body
    const body = {
      error: {
        code,
        message,
      },
    };

    if (err.details !== undefined) {
      body.error.details = err.details;
    }

    // Log — stack trace for 5xx, single-line for 4xx
    if (status >= 500) {
      logger.error(`${req.method} ${req.originalUrl} → ${status} ${code}`, {
        stack: err.stack,
        details: err.details,
      });
    } else {
      logger.warn(`${req.method} ${req.originalUrl} → ${status} ${code}: ${message}`);
    }

    // Ensure we don't send headers twice
    if (res.headersSent) {
      return;
    }

    res.status(status).json(body);
  };
}

module.exports = errorHandler;
