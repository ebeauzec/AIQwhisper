'use strict';

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'aiqwhisper.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// ---------------------------------------------------------------------------
// Singleton holder
// ---------------------------------------------------------------------------

/** @type {import('better-sqlite3').Database | null} */
let _db = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise the database.
 *
 * - Creates the `data/` directory if it does not already exist.
 * - Opens (or creates) the SQLite database file.
 * - Enables WAL journal mode and foreign-key enforcement.
 * - Reads `schema.sql` and executes every statement it contains so that all
 *   tables, indexes, and constraints are guaranteed to exist.
 *
 * This function is idempotent – calling it more than once is safe because
 * every DDL statement uses `CREATE … IF NOT EXISTS`.
 *
 * @param {object}  [options]
 * @param {string}  [options.dbPath]     Override the default database file path.
 * @param {string}  [options.schemaPath] Override the default schema file path.
 * @param {boolean} [options.verbose]    When true, log SQL execution to stderr.
 * @returns {import('better-sqlite3').Database} The initialised database handle.
 */
function initialize(options = {}) {
    if (_db) {
        return _db;
    }

    const dbPath = options.dbPath || DB_PATH;
    const schemaPath = options.schemaPath || SCHEMA_PATH;
    const verbose = options.verbose || false;

    // Ensure the data directory exists
    const dataDir = path.dirname(dbPath);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    // Open the database
    _db = new Database(dbPath, {
        verbose: verbose ? console.error : undefined,
    });

    // Enable WAL mode for better concurrent-read performance
    _db.pragma('journal_mode = WAL');

    // Enforce foreign-key constraints
    _db.pragma('foreign_keys = ON');

    // Tune for performance while keeping reasonable durability
    _db.pragma('synchronous = NORMAL');
    _db.pragma('cache_size = -64000'); // ~64 MB page cache
    _db.pragma('temp_store = MEMORY');

    // Read and execute the schema file
    if (!fs.existsSync(schemaPath)) {
        throw new Error(`Schema file not found: ${schemaPath}`);
    }

    const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
    _db.exec(schemaSql);

    return _db;
}

/**
 * Return the singleton database handle.
 *
 * If {@link initialize} has not been called yet it will be called
 * automatically with default options.
 *
 * @returns {import('better-sqlite3').Database}
 */
function getDb() {
    if (!_db) {
        initialize();
    }
    return _db;
}

/**
 * Close the database connection and clear the singleton reference.
 *
 * Safe to call even if the database was never opened.
 */
function close() {
    if (_db) {
        _db.close();
        _db = null;
    }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    initialize,
    getDb,
    close,
};
