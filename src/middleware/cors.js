/**
 * @module middleware/cors
 * @description Express CORS middleware that mirrors the request Origin,
 * allows all methods and headers, supports credentials, and handles
 * preflight OPTIONS requests with a 204 response.
 */

'use strict';

/**
 * CORS middleware factory.
 *
 * Applies permissive CORS headers suitable for development and
 * internal-network API servers. The `Access-Control-Allow-Origin`
 * header is set to the request's own `Origin` (mirrored), which
 * is required when `Access-Control-Allow-Credentials` is `true`.
 *
 * @returns {import('express').RequestHandler}
 *
 * @example
 *   const express = require('express');
 *   const cors = require('./middleware/cors');
 *   const app = express();
 *   app.use(cors());
 */
function cors() {
  /**
   * @param {import('express').Request}  req
   * @param {import('express').Response} res
   * @param {import('express').NextFunction} next
   */
  return (req, res, next) => {
    const origin = req.headers.origin || '*';

    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      req.headers['access-control-request-headers'] || '*'
    );
    res.setHeader('Access-Control-Max-Age', '86400');

    // Preflight — respond immediately with 204 No Content
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    next();
  };
}

module.exports = cors;
