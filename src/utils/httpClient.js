/**
 * @module utils/httpClient
 * @description Axios HTTP client factory with authentication, retry logic,
 * self-signed certificate support, and debug-level request/response logging.
 */

'use strict';

const https = require('https');
const axios = require('axios');
const config = require('../config');
const logger = require('./logger');

/** @constant {number} DEFAULT_TIMEOUT_MS - Default request timeout (30 s). */
const DEFAULT_TIMEOUT_MS = 30000;

/** @constant {number} MAX_RETRIES - Maximum retry attempts. */
const MAX_RETRIES = 3;

/** @constant {number} BASE_DELAY_MS - Base delay for exponential backoff. */
const BASE_DELAY_MS = 1000;

/**
 * Sleep for a given number of milliseconds.
 * @param {number} ms - Duration in milliseconds.
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Determine whether an Axios error is retriable.
 * Retries on network errors and 5xx status codes.
 * @param {import('axios').AxiosError} error
 * @returns {boolean}
 */
function isRetriable(error) {
  if (!error.response) return true; // network / timeout error
  return error.response.status >= 500;
}

/**
 * @typedef {Object} BasicAuth
 * @property {'basic'}  type     - Authentication type.
 * @property {string}   username - Basic auth username.
 * @property {string}   password - Basic auth password.
 */

/**
 * @typedef {Object} BearerAuth
 * @property {'bearer'} type  - Authentication type.
 * @property {string}   token - Bearer token.
 */

/**
 * @typedef {BasicAuth|BearerAuth} AuthConfig
 */

/**
 * Create a pre-configured Axios instance.
 *
 * @param {string}     baseURL          - The base URL for all requests.
 * @param {AuthConfig} [auth]           - Optional authentication configuration.
 * @param {Object}     [options]        - Additional overrides.
 * @param {number}     [options.timeout]        - Request timeout in ms (default 30 000).
 * @param {number}     [options.maxRetries]     - Max retry attempts (default 3).
 * @param {Object}     [options.headers]        - Extra default headers.
 * @param {boolean}    [options.rejectUnauthorized] - Override TLS verification.
 * @returns {import('axios').AxiosInstance}
 *
 * @example
 *   const client = createClient('https://cluster.local/api', {
 *     type: 'basic',
 *     username: 'admin',
 *     password: 's3cret',
 *   });
 *   const { data } = await client.get('/cluster');
 */
function createClient(baseURL, auth, options = {}) {
  const {
    timeout = DEFAULT_TIMEOUT_MS,
    maxRetries = MAX_RETRIES,
    headers: extraHeaders = {},
    rejectUnauthorized = config.rejectUnauthorized,
  } = options;

  // ----- Axios instance config -----
  /** @type {import('axios').AxiosRequestConfig} */
  const axiosConfig = {
    baseURL,
    timeout,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    httpsAgent: new https.Agent({ rejectUnauthorized }),
  };

  // Apply authentication
  if (auth) {
    if (auth.type === 'basic') {
      axiosConfig.auth = {
        username: auth.username,
        password: auth.password,
      };
    } else if (auth.type === 'bearer') {
      axiosConfig.headers.Authorization = `Bearer ${auth.token}`;
    }
  }

  const client = axios.create(axiosConfig);

  // ----- Request interceptor: debug logging -----
  client.interceptors.request.use((req) => {
    logger.debug(`HTTP >>> ${req.method.toUpperCase()} ${req.baseURL}${req.url || ''}`);
    return req;
  });

  // ----- Response interceptor: debug logging + retry -----
  client.interceptors.response.use(
    (res) => {
      logger.debug(
        `HTTP <<< ${res.status} ${res.config.method.toUpperCase()} ` +
        `${res.config.baseURL}${res.config.url || ''} (${res.headers['content-length'] || '?'} bytes)`
      );
      return res;
    },
    async (error) => {
      const cfg = error.config;

      // Initialise retry metadata
      if (!cfg || cfg.__retryCount === undefined) {
        if (cfg) cfg.__retryCount = 0;
      }

      if (cfg && cfg.__retryCount < maxRetries && isRetriable(error)) {
        cfg.__retryCount += 1;
        const delay = BASE_DELAY_MS * Math.pow(2, cfg.__retryCount - 1);
        const status = error.response ? error.response.status : 'NETWORK_ERROR';
        logger.warn(
          `HTTP retry ${cfg.__retryCount}/${maxRetries} after ${status} — ` +
          `${cfg.method.toUpperCase()} ${cfg.baseURL}${cfg.url || ''} (wait ${delay} ms)`
        );
        await sleep(delay);
        return client.request(cfg);
      }

      // Log final failure
      const finalStatus = error.response ? error.response.status : 'NETWORK_ERROR';
      logger.error(
        `HTTP FAILED ${finalStatus} ${cfg ? cfg.method.toUpperCase() : '?'} ` +
        `${cfg ? cfg.baseURL : ''}${cfg ? cfg.url || '' : ''}: ${error.message}`
      );

      return Promise.reject(error);
    }
  );

  return client;
}

module.exports = { createClient };
