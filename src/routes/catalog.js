'use strict';

/**
 * @module routes/catalog
 * @description Express router for the API endpoint catalog.
 *
 * Returns a machine- and human-readable description of every available API
 * endpoint grouped by resource.
 *
 * Endpoints:
 *   GET /           – Full API endpoint catalog.
 *   GET /:platform  – Platform-specific endpoint list.
 */

const { Router } = require('express');

const router = Router();

/**
 * Full catalog of all API endpoints with descriptions.
 *
 * @type {Object[]}
 */
const CATALOG = [
  // ----- Systems -----
  {
    group: 'systems',
    platform: 'all',
    endpoints: [
      { method: 'GET', path: '/api/systems', description: 'List all registered storage systems.' },
      { method: 'POST', path: '/api/systems', description: 'Register a new storage system.' },
      { method: 'GET', path: '/api/systems/:id', description: 'Get system details by ID.' },
      { method: 'PUT', path: '/api/systems/:id', description: 'Update system configuration.' },
      { method: 'DELETE', path: '/api/systems/:id', description: 'Delete a system and all related data.' },
      { method: 'POST', path: '/api/systems/:id/test', description: 'Test connectivity to a system.' },
      { method: 'POST', path: '/api/systems/:id/collect', description: 'Trigger immediate data collection.' },
    ],
  },
  // ----- Dashboard -----
  {
    group: 'dashboard',
    platform: 'all',
    endpoints: [
      { method: 'GET', path: '/api/dashboard/summary', description: 'Aggregated dashboard summary.' },
      { method: 'GET', path: '/api/dashboard/health', description: 'Per-system health scores.' },
      { method: 'GET', path: '/api/dashboard/capacity', description: 'Capacity overview (worst resources).' },
      { method: 'GET', path: '/api/dashboard/issues', description: 'Open issue counts by severity.' },
      { method: 'GET', path: '/api/dashboard/recent-events', description: 'Latest events across all systems.' },
    ],
  },
  // ----- Inventory – ONTAP -----
  {
    group: 'inventory',
    platform: 'ontap',
    endpoints: [
      { method: 'GET', path: '/api/inventory/clusters', description: 'All ONTAP clusters.' },
      { method: 'GET', path: '/api/inventory/nodes', description: 'All ONTAP nodes.' },
      { method: 'GET', path: '/api/inventory/aggregates', description: 'All ONTAP aggregates (filterable by system_id).' },
      { method: 'GET', path: '/api/inventory/volumes', description: 'All ONTAP volumes (filterable by system_id, svm_name).' },
      { method: 'GET', path: '/api/inventory/luns', description: 'All ONTAP LUNs.' },
      { method: 'GET', path: '/api/inventory/lifs', description: 'All ONTAP logical interfaces.' },
      { method: 'GET', path: '/api/inventory/svms', description: 'All ONTAP storage virtual machines.' },
    ],
  },
  // ----- Inventory – StorageGRID -----
  {
    group: 'inventory',
    platform: 'storagegrid',
    endpoints: [
      { method: 'GET', path: '/api/inventory/grids', description: 'All StorageGRID grids.' },
      { method: 'GET', path: '/api/inventory/buckets', description: 'All StorageGRID S3 buckets.' },
    ],
  },
  // ----- Inventory – E-Series -----
  {
    group: 'inventory',
    platform: 'eseries',
    endpoints: [
      { method: 'GET', path: '/api/inventory/arrays', description: 'All E-Series storage arrays.' },
      { method: 'GET', path: '/api/inventory/disks', description: 'All disks / drives (ONTAP + E-Series combined).' },
    ],
  },
  // ----- Issues -----
  {
    group: 'issues',
    platform: 'all',
    endpoints: [
      { method: 'GET', path: '/api/issues', description: 'All issues with optional filters (severity, category, system_id, status).' },
      { method: 'GET', path: '/api/issues/:id', description: 'Issue detail with related recommendations.' },
      { method: 'PATCH', path: '/api/issues/:id/acknowledge', description: 'Mark an issue as acknowledged.' },
      { method: 'PATCH', path: '/api/issues/:id/resolve', description: 'Mark an issue as resolved.' },
    ],
  },
  // ----- Recommendations -----
  {
    group: 'recommendations',
    platform: 'all',
    endpoints: [
      { method: 'GET', path: '/api/recommendations', description: 'All recommendations with filters.' },
      { method: 'GET', path: '/api/recommendations/:id', description: 'Recommendation detail with remediation steps and CLI commands.' },
    ],
  },
  // ----- Events -----
  {
    group: 'events',
    platform: 'all',
    endpoints: [
      { method: 'GET', path: '/api/events', description: 'Unified event log (EMS, alerts, MEL). Filters: system_id, severity, start_time, end_time, limit.' },
    ],
  },
  // ----- Performance -----
  {
    group: 'performance',
    platform: 'all',
    endpoints: [
      { method: 'GET', path: '/api/performance/:systemId/overview', description: 'System-level aggregated performance metrics.' },
      { method: 'GET', path: '/api/performance/:systemId/resources', description: 'List resource types with available metrics.' },
      { method: 'GET', path: '/api/performance/:systemId/timeseries', description: 'Time-series data with automatic tier selection.' },
    ],
  },
  // ----- Capacity -----
  {
    group: 'capacity',
    platform: 'all',
    endpoints: [
      { method: 'GET', path: '/api/capacity/projections', description: 'All capacity projections.' },
      { method: 'GET', path: '/api/capacity/runway', description: 'Resources sorted by days-to-full (threshold filter).' },
      { method: 'GET', path: '/api/capacity/growth', description: 'Growth-rate trending per resource.' },
      { method: 'GET', path: '/api/capacity/efficiency', description: 'Storage efficiency ratios per system.' },
    ],
  },
  // ----- Reports -----
  {
    group: 'reports',
    platform: 'all',
    endpoints: [
      { method: 'POST', path: '/api/reports/generate', description: 'Generate a report (executive, capacity, firmware, issues, security).' },
      { method: 'GET', path: '/api/reports', description: 'List all generated reports.' },
      { method: 'GET', path: '/api/reports/:id', description: 'Get report detail with full data payload.' },
    ],
  },
  // ----- Learning -----
  {
    group: 'learning',
    platform: 'all',
    endpoints: [
      { method: 'GET', path: '/api/learning/status', description: 'Auto-learner status (last run, records learned).' },
      { method: 'POST', path: '/api/learning/update', description: 'Trigger an immediate learning cycle.' },
      { method: 'GET', path: '/api/learning/changelog', description: 'Recent KB changes from the learning log.' },
      { method: 'GET', path: '/api/learning/versions', description: 'Known software versions from the KB.' },
    ],
  },
  // ----- Catalog -----
  {
    group: 'catalog',
    platform: 'all',
    endpoints: [
      { method: 'GET', path: '/api/catalog', description: 'Full API endpoint catalog.' },
      { method: 'GET', path: '/api/catalog/:platform', description: 'Platform-specific endpoint list.' },
    ],
  },
];

// ---------------------------------------------------------------------------
// GET / – Full catalog
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/catalog
 * @desc    Return the complete API endpoint catalog.
 * @returns {{ data: Object[] }}
 */
router.get('/', (req, res, next) => {
  try {
    res.json({ data: CATALOG });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /:platform – Platform-specific catalog
// ---------------------------------------------------------------------------

/**
 * @route   GET /api/catalog/:platform
 * @desc    Return endpoints relevant to a specific platform.
 * @param   {string} platform – "ontap" | "storagegrid" | "eseries" | "all"
 * @returns {{ data: Object[] }}
 */
router.get('/:platform', (req, res, next) => {
  try {
    const platform = req.params.platform.toLowerCase();
    const filtered = CATALOG.filter(
      (group) => group.platform === platform || group.platform === 'all',
    );

    if (!filtered.length) {
      return res.status(404).json({
        error: `No endpoints found for platform: ${platform}. Valid values: ontap, storagegrid, eseries, all.`,
      });
    }

    res.json({ data: filtered });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
