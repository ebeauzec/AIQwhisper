# 📦 AIQwhisper — Installation Guide

> Complete guide to installing, configuring, and running AIQwhisper in production.

---

## Table of Contents

- [1. System Requirements](#1-system-requirements)
- [2. Prerequisites](#2-prerequisites)
- [3. Step-by-Step Installation](#3-step-by-step-installation)
- [4. Configuration Deep Dive](#4-configuration-deep-dive)
- [5. Adding Your First System](#5-adding-your-first-system)
- [6. Running as a Service](#6-running-as-a-service)
- [7. Upgrading](#7-upgrading)
- [8. Backup & Restore](#8-backup--restore)
- [9. Troubleshooting](#9-troubleshooting)
- [10. Security Hardening](#10-security-hardening)

---

## 1. System Requirements

AIQwhisper is designed to be extremely lightweight. It runs on virtually any system capable of running Node.js.

### Minimum Hardware

| Resource | Minimum | Recommended | Notes |
|----------|---------|-------------|-------|
| **RAM** | 256 MB | 512 MB | Scales with number of monitored systems |
| **Disk** | 1 GB | 5 GB | Database grows with retention settings |
| **CPU** | 1 core | 2 cores | Collection runs in parallel |

### Software Requirements

| Requirement | Version | Notes |
|-------------|---------|-------|
| **Node.js** | 18.0.0+ | LTS versions recommended (18.x, 20.x, 22.x) |
| **npm** | 9.0+ | Bundled with Node.js |
| **Git** | Any | For cloning the repository |
| **OS** | Any | Windows, macOS, Linux, FreeBSD, Docker |

### Supported Storage Platforms

| Platform | Minimum Version | API Endpoint | Auth Method |
|----------|----------------|--------------|-------------|
| **NetApp ONTAP** | 9.6+ | REST API (`/api/*`) | Basic Auth, OAuth 2.0, Certificate |
| **NetApp StorageGRID** | 11.6+ | Grid Management API (`/api/v4/*`) | Bearer Token |
| **NetApp E-Series** | SANtricity 11.60+ | Web Services (`/devmgr/v2/*`) | Basic Auth |

---

## 2. Prerequisites

### 2.1 Installing Node.js

#### Linux (Ubuntu/Debian)

```bash
# Using NodeSource (recommended)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify
node --version   # Should be v18.x or higher
npm --version    # Should be v9.x or higher
```

#### Linux (RHEL/CentOS/Rocky)

```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs

node --version
npm --version
```

#### macOS

```bash
# Using Homebrew
brew install node@20

# Or download from https://nodejs.org/
node --version
npm --version
```

#### Windows

1. Download the installer from [https://nodejs.org/](https://nodejs.org/)
2. Run the `.msi` installer (LTS version recommended)
3. Open PowerShell and verify:

```powershell
node --version
npm --version
```

### 2.2 Network Requirements

AIQwhisper connects to your storage systems over HTTPS. Ensure the following ports are accessible from the server running AIQwhisper:

| Platform | Port | Protocol | Direction |
|----------|------|----------|-----------|
| **ONTAP** | 443 | HTTPS | AIQwhisper → Cluster Management LIF |
| **StorageGRID** | 443 or 8443 | HTTPS | AIQwhisper → Admin Node |
| **E-Series** | 8443 | HTTPS | AIQwhisper → SANtricity Web Services Proxy or Embedded |

> **Note:** If using a reverse proxy in front of AIQwhisper, port 3080 (default) or your configured port must be accessible from client browsers.

### 2.3 Credential Requirements

#### ONTAP — Creating a Read-Only Monitoring Role

For least-privilege access, create a dedicated monitoring user on your ONTAP cluster:

```bash
# SSH into the cluster management LIF
ssh admin@cluster01

# Create a read-only role
security login role create -vserver cluster01 -role aiqwhisper_monitor -cmddirname "version" -access readonly
security login role create -vserver cluster01 -role aiqwhisper_monitor -cmddirname "cluster" -access readonly
security login role create -vserver cluster01 -role aiqwhisper_monitor -cmddirname "storage" -access readonly
security login role create -vserver cluster01 -role aiqwhisper_monitor -cmddirname "network" -access readonly
security login role create -vserver cluster01 -role aiqwhisper_monitor -cmddirname "volume" -access readonly
security login role create -vserver cluster01 -role aiqwhisper_monitor -cmddirname "vserver" -access readonly
security login role create -vserver cluster01 -role aiqwhisper_monitor -cmddirname "security" -access readonly
security login role create -vserver cluster01 -role aiqwhisper_monitor -cmddirname "statistics" -access readonly
security login role create -vserver cluster01 -role aiqwhisper_monitor -cmddirname "system" -access readonly

# Create the REST API user
security login create -vserver cluster01 -user-or-group-name aiqwhisper -application http -authentication-method password -role aiqwhisper_monitor
security login create -vserver cluster01 -user-or-group-name aiqwhisper -application ontapi -authentication-method password -role aiqwhisper_monitor
```

> **Note:** Using `admin` credentials works but is not recommended for production. The read-only role limits AIQwhisper to observation-only access.

#### StorageGRID — Creating an API User

1. Log into the Grid Manager web UI
2. Navigate to **Configuration → Access Control → Admin Groups**
3. Create a new group with the **Storage Admin (Read-Only)** permission
4. Navigate to **Configuration → Access Control → Admin Users**
5. Create a new user assigned to the read-only group
6. Note the username — you'll use it to obtain a bearer token

#### E-Series — SANtricity Web Services

AIQwhisper connects to E-Series arrays through the SANtricity Web Services API:

- **Embedded Web Services**: Direct connection to the array controller (port 8443)
- **Web Services Proxy**: Centralized proxy managing multiple arrays (recommended for 5+ arrays)

Ensure you have a user with at least `monitor` role access.

---

## 3. Step-by-Step Installation

### Step 1: Clone the Repository

```bash
git clone https://github.com/ebeauzec/AIQwhisper.git
cd AIQwhisper
```

### Step 2: Install Dependencies

```bash
npm install
```

This installs all required packages:
- `express` — HTTP server
- `better-sqlite3` — Embedded database
- `axios` — HTTP client for API calls
- `dotenv` — Environment configuration
- `cors` — Cross-Origin Resource Sharing
- `node-cron` — Job scheduling
- `winston` — Logging

### Step 3: Configure Environment

```bash
# Linux / macOS
cp .env.example .env

# Windows (PowerShell)
Copy-Item .env.example .env
```

Edit `.env` with your preferred editor:

```bash
nano .env      # Linux
code .env      # VS Code
notepad .env   # Windows
```

> **⚠️ CRITICAL:** Change the `MASTER_PASSPHRASE` from the default value. This passphrase encrypts all stored storage system credentials. Choose a strong, unique passphrase and store it securely.

```ini
MASTER_PASSPHRASE=your-secure-passphrase-here-min-16-chars
```

### Step 4: Initialize the Database

```bash
npm run init-db
```

This creates the SQLite database at `./data/aiqwhisper.db` with all required tables and indexes.

### Step 5: Start the Server

```bash
npm start
```

You should see:

```
[2026-07-15 20:00:00] [INFO] AIQwhisper v2.0.0 starting...
[2026-07-15 20:00:00] [INFO] Database initialized at ./data/aiqwhisper.db
[2026-07-15 20:00:00] [INFO] Server listening on http://127.0.0.1:3080
[2026-07-15 20:00:00] [INFO] Scheduler started (inventory: 15m, performance: 5m, capacity: 15m)
```

### Step 6: Verify Installation

```bash
curl http://localhost:3080/health
```

Expected response:

```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "version": "2.0.0",
    "uptime": 5,
    "database": "connected",
    "systems": 0,
    "lastCollection": null
  }
}
```

### Step 7: Open the Web UI

Navigate to [http://localhost:3080](http://localhost:3080) in your browser.

---

## 4. Configuration Deep Dive

All configuration is managed through environment variables in the `.env` file. Below is every variable with detailed explanations.

### 4.1 Server Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3080` | TCP port for the HTTP server. Choose any available port. |
| `BIND_ADDRESS` | `127.0.0.1` | Network interface to bind to. Use `127.0.0.1` for local-only access or `0.0.0.0` for LAN access. |
| `LOG_LEVEL` | `info` | Logging verbosity: `debug`, `info`, `warn`, `error`. Use `debug` for troubleshooting. |

### 4.2 Database

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_PATH` | `./data/aiqwhisper.db` | Path to the SQLite database file. Can be absolute or relative to the project root. |

### 4.3 Security

| Variable | Default | Description |
|----------|---------|-------------|
| `MASTER_PASSPHRASE` | `changeme` | **CHANGE THIS.** Used to encrypt storage system credentials (AES-256-GCM). Minimum 16 characters recommended. If changed after systems are registered, existing credentials must be re-entered. |

### 4.4 Collection Intervals

| Variable | Default | Description |
|----------|---------|-------------|
| `POLL_INTERVAL_MINUTES` | `15` | How often to collect inventory and configuration data from all registered systems. |
| `PERF_POLL_INTERVAL_MINUTES` | `5` | How often to collect performance metrics. Lower values provide higher fidelity but increase database size. |
| `CAPACITY_POLL_INTERVAL_MINUTES` | `15` | How often to snapshot capacity data for trend analysis and projections. |

### 4.5 Data Retention

| Variable | Default | Description |
|----------|---------|-------------|
| `RETENTION_RAW_DAYS` | `7` | Days to retain raw (5-minute granularity) performance metrics. |
| `RETENTION_HOURLY_DAYS` | `30` | Days to retain hourly rollup data (statistical aggregations). |
| `RETENTION_DAILY_DAYS` | `180` | Days to retain daily rollup data (6 months). |
| `RETENTION_WEEKLY_DAYS` | `365` | Days to retain weekly rollup data (12 months). |

> **Note:** Rollups include min, max, avg, p95, p99, and sample count. Reducing retention reduces database size.

### 4.6 Auto-Learning

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTO_LEARN_ENABLED` | `true` | Enable automatic fetching of EOL/lifecycle data from public sources. Set to `false` for air-gapped environments. |
| `AUTO_LEARN_SCHEDULE` | `0 2 * * 0` | Cron expression for the auto-learner schedule. Default: Sundays at 2:00 AM. |
| `EOL_API_URL` | `https://endoflife.date/api/v1/products` | Public API endpoint for end-of-life data. |

### 4.7 SSL

| Variable | Default | Description |
|----------|---------|-------------|
| `REJECT_UNAUTHORIZED` | `false` | Set to `true` to reject connections to storage systems with self-signed or invalid SSL certificates. Default `false` is typical for on-premises environments. |

### 4.8 Example Configurations

#### Minimal (Development / Testing)

```ini
PORT=3080
BIND_ADDRESS=127.0.0.1
LOG_LEVEL=debug
DB_PATH=./data/aiqwhisper.db
MASTER_PASSPHRASE=dev-testing-only-changeme
POLL_INTERVAL_MINUTES=60
PERF_POLL_INTERVAL_MINUTES=15
```

#### Production

```ini
PORT=3080
BIND_ADDRESS=0.0.0.0
LOG_LEVEL=info
DB_PATH=/opt/aiqwhisper/data/aiqwhisper.db
MASTER_PASSPHRASE=Kj8#mP2$vL9nQ4wX!hR6tY0bN3cF5gA7
POLL_INTERVAL_MINUTES=15
PERF_POLL_INTERVAL_MINUTES=5
CAPACITY_POLL_INTERVAL_MINUTES=15
RETENTION_RAW_DAYS=7
RETENTION_HOURLY_DAYS=30
RETENTION_DAILY_DAYS=180
RETENTION_WEEKLY_DAYS=365
AUTO_LEARN_ENABLED=true
AUTO_LEARN_SCHEDULE=0 2 * * 0
REJECT_UNAUTHORIZED=false
```

#### Air-Gapped Environment

```ini
PORT=3080
BIND_ADDRESS=0.0.0.0
LOG_LEVEL=info
DB_PATH=/opt/aiqwhisper/data/aiqwhisper.db
MASTER_PASSPHRASE=SecureAirGappedPassphrase!2026
POLL_INTERVAL_MINUTES=15
PERF_POLL_INTERVAL_MINUTES=5
AUTO_LEARN_ENABLED=false
REJECT_UNAUTHORIZED=false
```

---

## 5. Adding Your First System

### 5.1 Adding an ONTAP Cluster

```bash
curl -X POST http://localhost:3080/api/systems \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "prod-ontap-01",
    "type": "ontap",
    "hostname": "10.0.1.100",
    "username": "aiqwhisper",
    "password": "SecurePass123!"
  }'
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "prod-ontap-01",
    "type": "ontap",
    "hostname": "10.0.1.100",
    "status": "pending",
    "created_at": "2026-07-15T16:00:00.000Z"
  }
}
```

### 5.2 Adding a StorageGRID Grid

StorageGRID uses bearer token authentication. AIQwhisper handles token management internally — provide the Grid Manager credentials:

```bash
curl -X POST http://localhost:3080/api/systems \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "prod-sgrid-01",
    "type": "storagegrid",
    "hostname": "sgrid-admin.example.com",
    "port": 8443,
    "username": "aiqwhisper-monitor",
    "password": "GridPass456!"
  }'
```

### 5.3 Adding an E-Series Array

#### Direct Connection (Embedded Web Services)

```bash
curl -X POST http://localhost:3080/api/systems \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "prod-eseries-01",
    "type": "eseries",
    "hostname": "10.0.2.50",
    "port": 8443,
    "username": "monitor",
    "password": "EseriesPass789!"
  }'
```

#### Via SANtricity Web Services Proxy

```bash
curl -X POST http://localhost:3080/api/systems \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "prod-eseries-02",
    "type": "eseries",
    "hostname": "10.0.2.100",
    "port": 8443,
    "username": "admin",
    "password": "ProxyPass000!",
    "proxy_url": "https://10.0.2.100:8443"
  }'
```

### 5.4 Testing Connectivity

After adding a system, test that AIQwhisper can reach it:

```bash
curl -X POST http://localhost:3080/api/systems/1/test
```

**Success response:**

```json
{
  "success": true,
  "data": {
    "reachable": true,
    "latency_ms": 45,
    "api_version": "9.14",
    "cluster_name": "prod-ontap-01",
    "message": "Connection successful"
  }
}
```

### 5.5 Triggering First Collection

Don't want to wait for the scheduled poll? Trigger an immediate collection:

```bash
curl -X POST http://localhost:3080/api/systems/1/collect
```

**Response:**

```json
{
  "success": true,
  "data": {
    "message": "Collection started for prod-ontap-01",
    "job_id": "collect-1-1721059200"
  }
}
```

---

## 6. Running as a Service

### 6.1 systemd (Linux)

Create a service unit file:

```bash
sudo nano /etc/systemd/system/aiqwhisper.service
```

```ini
[Unit]
Description=AIQwhisper - NetApp Infrastructure Manager
Documentation=https://github.com/ebeauzec/AIQwhisper
After=network.target

[Service]
Type=simple
User=aiqwhisper
Group=aiqwhisper
WorkingDirectory=/opt/aiqwhisper
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=aiqwhisper
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
# Create a dedicated user
sudo useradd -r -s /bin/false aiqwhisper

# Set ownership
sudo chown -R aiqwhisper:aiqwhisper /opt/aiqwhisper

# Enable and start the service
sudo systemctl daemon-reload
sudo systemctl enable aiqwhisper
sudo systemctl start aiqwhisper

# Check status
sudo systemctl status aiqwhisper

# View logs
sudo journalctl -u aiqwhisper -f
sudo journalctl -u aiqwhisper --since "1 hour ago"
```

### 6.2 PM2 (Cross-Platform)

PM2 is a production process manager for Node.js that works on Linux, macOS, and Windows.

```bash
# Install PM2 globally
npm install -g pm2
```

Create `ecosystem.config.js` in the project root:

```javascript
module.exports = {
  apps: [{
    name: 'aiqwhisper',
    script: 'src/index.js',
    cwd: '/opt/aiqwhisper',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production'
    },
    error_file: '/var/log/aiqwhisper/error.log',
    out_file: '/var/log/aiqwhisper/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
```

Start and configure:

```bash
# Start with PM2
pm2 start ecosystem.config.js

# Save the process list
pm2 save

# Configure PM2 to start on boot
pm2 startup
# Follow the output instructions (copy/paste the generated command)

# Monitor
pm2 monit
pm2 logs aiqwhisper
```

### 6.3 Windows Service (NSSM)

[NSSM (Non-Sucking Service Manager)](https://nssm.cc/) is the simplest way to run AIQwhisper as a Windows service.

```powershell
# Download NSSM from https://nssm.cc/download
# Extract to C:\tools\nssm\

# Install the service
C:\tools\nssm\win64\nssm.exe install AIQwhisper "C:\Program Files\nodejs\node.exe" "C:\AIQwhisper\src\index.js"

# Configure the service
nssm set AIQwhisper AppDirectory "C:\AIQwhisper"
nssm set AIQwhisper DisplayName "AIQwhisper - NetApp Infrastructure Manager"
nssm set AIQwhisper Description "On-premises NetApp infrastructure monitoring and management"
nssm set AIQwhisper Start SERVICE_AUTO_START
nssm set AIQwhisper AppStdout "C:\AIQwhisper\logs\service-stdout.log"
nssm set AIQwhisper AppStderr "C:\AIQwhisper\logs\service-stderr.log"
nssm set AIQwhisper AppRotateFiles 1
nssm set AIQwhisper AppRotateBytes 10485760

# Start the service
nssm start AIQwhisper

# Check status
nssm status AIQwhisper
```

---

## 7. Upgrading

### Standard Upgrade Procedure

```bash
# 1. Stop the service
sudo systemctl stop aiqwhisper   # or pm2 stop aiqwhisper

# 2. Backup (IMPORTANT — do this before every upgrade)
cp data/aiqwhisper.db data/aiqwhisper.db.backup-$(date +%Y%m%d)
cp .env .env.backup-$(date +%Y%m%d)

# 3. Pull the latest code
git pull origin main

# 4. Install/update dependencies
npm install

# 5. Start the server (migrations run automatically)
sudo systemctl start aiqwhisper   # or pm2 restart aiqwhisper

# 6. Verify
curl http://localhost:3080/health
```

> **Note:** Database migrations run automatically on server start. New tables and columns are added without data loss. The server logs will indicate any migrations applied.

### Rollback Procedure

If an upgrade causes issues:

```bash
# 1. Stop the server
sudo systemctl stop aiqwhisper

# 2. Revert to previous version
git checkout <previous-tag-or-commit>
npm install

# 3. Restore the database backup
cp data/aiqwhisper.db.backup-YYYYMMDD data/aiqwhisper.db

# 4. Restore the configuration
cp .env.backup-YYYYMMDD .env

# 5. Restart
sudo systemctl start aiqwhisper
```

---

## 8. Backup & Restore

### What to Back Up

| File | Location | Description |
|------|----------|-------------|
| **Database** | `./data/aiqwhisper.db` | All inventory, metrics, issues, learning data |
| **Configuration** | `./.env` | Server configuration and master passphrase |

### Manual Backup

```bash
# Create a timestamped backup
BACKUP_DIR="/backup/aiqwhisper/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp data/aiqwhisper.db "$BACKUP_DIR/"
cp .env "$BACKUP_DIR/"
echo "Backup saved to $BACKUP_DIR"
```

### Automated Backup Script

Create `/opt/aiqwhisper/scripts/backup.sh`:

```bash
#!/bin/bash
# AIQwhisper Automated Backup Script
# Add to crontab: 0 1 * * * /opt/aiqwhisper/scripts/backup.sh

set -euo pipefail

AIQWHISPER_DIR="/opt/aiqwhisper"
BACKUP_BASE="/backup/aiqwhisper"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="$BACKUP_BASE/$TIMESTAMP"
RETENTION_DAYS=30

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Backup database (using SQLite online backup for consistency)
sqlite3 "$AIQWHISPER_DIR/data/aiqwhisper.db" ".backup '$BACKUP_DIR/aiqwhisper.db'"

# Backup configuration
cp "$AIQWHISPER_DIR/.env" "$BACKUP_DIR/.env"

# Compress
cd "$BACKUP_BASE"
tar -czf "aiqwhisper-$TIMESTAMP.tar.gz" "$TIMESTAMP"
rm -rf "$TIMESTAMP"

# Rotate old backups
find "$BACKUP_BASE" -name "aiqwhisper-*.tar.gz" -mtime +$RETENTION_DAYS -delete

echo "[$(date)] Backup completed: aiqwhisper-$TIMESTAMP.tar.gz"
```

```bash
chmod +x /opt/aiqwhisper/scripts/backup.sh

# Add to crontab (daily at 1 AM)
echo "0 1 * * * /opt/aiqwhisper/scripts/backup.sh >> /var/log/aiqwhisper-backup.log 2>&1" | crontab -
```

### Restore Procedure

```bash
# 1. Stop the server
sudo systemctl stop aiqwhisper

# 2. Extract the backup
cd /backup/aiqwhisper
tar -xzf aiqwhisper-20260715-010000.tar.gz

# 3. Restore files
cp 20260715-010000/aiqwhisper.db /opt/aiqwhisper/data/aiqwhisper.db
cp 20260715-010000/.env /opt/aiqwhisper/.env

# 4. Start the server
sudo systemctl start aiqwhisper
```

---

## 9. Troubleshooting

### Issue 1: Port Already in Use

**Symptoms:**
```
Error: listen EADDRINUSE: address already in use :::3080
```

**Cause:** Another process is using port 3080.

**Solution:**

```bash
# Find the process using the port
# Linux/macOS
lsof -i :3080
# or
netstat -tlnp | grep 3080

# Windows
netstat -ano | findstr :3080

# Kill the process or change the port in .env
PORT=3081
```

---

### Issue 2: Cannot Connect to ONTAP (SSL Certificate Errors)

**Symptoms:**
```
Error: unable to verify the first certificate
Error: self-signed certificate in certificate chain
```

**Cause:** ONTAP uses self-signed SSL certificates by default, and Node.js rejects them.

**Solution:**

Ensure your `.env` file has:

```ini
REJECT_UNAUTHORIZED=false
```

Then restart AIQwhisper. This allows connections to systems with self-signed certificates, which is standard for on-premises environments.

---

### Issue 3: StorageGRID Authentication Failures

**Symptoms:**
```
Error: Request failed with status code 401
StorageGRID authentication failed for sgrid-admin.example.com
```

**Cause:** Invalid credentials, expired token, or incorrect API endpoint.

**Solution:**

1. Verify the admin node hostname and port (usually 443 or 8443)
2. Confirm the username has API access permissions
3. Test credentials directly:

```bash
curl -k -X POST https://sgrid-admin.example.com:8443/api/v4/authorize \
  -H 'Content-Type: application/json' \
  -d '{"username":"aiqwhisper-monitor","password":"GridPass456!","cookie":false}'
```

4. Ensure the user's group has the required permissions enabled

---

### Issue 4: E-Series Web Services Proxy Not Responding

**Symptoms:**
```
Error: connect ECONNREFUSED 10.0.2.100:8443
Error: Request failed with status code 503
```

**Cause:** SANtricity Web Services Proxy is not running or not accessible.

**Solution:**

1. Verify the Web Services Proxy is running on the target host
2. Check the port (default: 8443)
3. Test direct connectivity:

```bash
curl -k https://10.0.2.100:8443/devmgr/v2/storage-systems
```

4. If using embedded web services, connect directly to the controller IP
5. Verify firewall rules allow HTTPS traffic on port 8443

---

### Issue 5: Database Locked Errors

**Symptoms:**
```
Error: SQLITE_BUSY: database is locked
```

**Cause:** Multiple processes attempting to write to the SQLite database simultaneously, or a backup process holding a lock.

**Solution:**

1. Ensure only one instance of AIQwhisper is running:

```bash
ps aux | grep aiqwhisper
# Kill duplicate processes if found
```

2. If running backups, use the SQLite online backup method (see [Backup & Restore](#8-backup--restore)) instead of copying the file directly while the server is running.

3. Set the busy timeout by restarting the server — AIQwhisper configures WAL mode with a 5-second busy timeout by default.

---

### Issue 6: High Memory Usage

**Symptoms:** AIQwhisper process using more memory than expected (>512 MB).

**Cause:** Monitoring a large number of systems with aggressive collection intervals.

**Solution:**

1. Increase collection intervals:

```ini
POLL_INTERVAL_MINUTES=30
PERF_POLL_INTERVAL_MINUTES=15
```

2. Reduce data retention:

```ini
RETENTION_RAW_DAYS=3
RETENTION_HOURLY_DAYS=14
```

3. Set a Node.js memory limit:

```bash
NODE_OPTIONS="--max-old-space-size=384" npm start
```

---

### Issue 7: Performance Data Not Collecting

**Symptoms:** Dashboard shows inventory data but performance charts are empty.

**Cause:** Performance counters may not be enabled, or the collection hasn't had time to run.

**Solution:**

1. Wait at least two performance poll intervals (default: 10 minutes)
2. Check logs for collection errors:

```bash
# View recent logs
journalctl -u aiqwhisper --since "30 minutes ago" | grep -i perf

# Or check log output directly
LOG_LEVEL=debug npm start
```

3. For ONTAP, verify the REST API performance endpoints are accessible:

```bash
curl -k -u aiqwhisper:password https://10.0.1.100/api/cluster/counter/tables
```

4. Trigger a manual collection:

```bash
curl -X POST http://localhost:3080/api/systems/1/collect
```

---

### Issue 8: Auto-Learner Failing (Air-Gapped Environment)

**Symptoms:**
```
Auto-learner failed: getaddrinfo ENOTFOUND endoflife.date
```

**Cause:** The server cannot reach public internet endpoints.

**Solution:**

Disable auto-learning in your `.env`:

```ini
AUTO_LEARN_ENABLED=false
```

You can manually update the learning catalog by importing data from a connected system:

```bash
# On a connected machine, download the catalog
curl https://endoflife.date/api/v1/products/netapp-ontap.json -o ontap-eol.json

# Transfer the file to the air-gapped environment
# Then import via the API
curl -X POST http://localhost:3080/api/learning/update \
  -H 'Content-Type: application/json' \
  -d @ontap-eol.json
```

---

### Issue 9: Slow Dashboard Loading

**Symptoms:** The web UI dashboard takes 10+ seconds to load.

**Cause:** Large database with many systems and extensive history.

**Solution:**

1. Check database size:

```bash
ls -lh data/aiqwhisper.db
```

2. Run data retention cleanup manually:

```bash
npm run collect  # Triggers cleanup as part of the collection cycle
```

3. Optimize the database:

```bash
sqlite3 data/aiqwhisper.db "PRAGMA optimize; VACUUM;"
```

4. Consider reducing retention settings if the database exceeds 2 GB.

---

### Issue 10: Permission Denied Errors on Linux

**Symptoms:**
```
Error: EACCES: permission denied, open './data/aiqwhisper.db'
Error: EACCES: permission denied, mkdir './data'
```

**Cause:** The Node.js process doesn't have write permissions to the data directory.

**Solution:**

```bash
# Fix ownership
sudo chown -R aiqwhisper:aiqwhisper /opt/aiqwhisper

# Fix permissions
chmod 750 /opt/aiqwhisper
chmod 750 /opt/aiqwhisper/data
chmod 640 /opt/aiqwhisper/.env
chmod 640 /opt/aiqwhisper/data/aiqwhisper.db
```

If running with systemd, ensure the service file specifies the correct `User` and `Group`.

---

## 10. Security Hardening

### 10.1 Change the Master Passphrase

The default passphrase `changeme` is **not secure**. Update it immediately:

```ini
MASTER_PASSPHRASE=your-secure-passphrase-at-least-32-chars-long!
```

> **⚠️ Warning:** Changing the passphrase after systems are registered will invalidate stored credentials. You'll need to re-enter the password for each system.

### 10.2 Bind to Localhost

Keep AIQwhisper bound to localhost and use a reverse proxy for external access:

```ini
BIND_ADDRESS=127.0.0.1
```

### 10.3 Reverse Proxy with nginx

```nginx
server {
    listen 443 ssl;
    server_name aiqwhisper.example.com;

    ssl_certificate     /etc/letsencrypt/live/aiqwhisper.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/aiqwhisper.example.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    location / {
        proxy_pass http://127.0.0.1:3080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name aiqwhisper.example.com;
    return 301 https://$server_name$request_uri;
}
```

### 10.4 HTTPS with Let's Encrypt

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d aiqwhisper.example.com

# Auto-renewal is configured automatically
sudo certbot renew --dry-run
```

### 10.5 Use Read-Only Credentials

Always create dedicated, read-only monitoring accounts on your storage systems (see [Prerequisites](#23-credential-requirements)). Never use `admin` accounts in production.

### 10.6 File Permissions

```bash
# Restrict access to sensitive files
chmod 640 /opt/aiqwhisper/.env
chmod 640 /opt/aiqwhisper/data/aiqwhisper.db
chmod 750 /opt/aiqwhisper/data

# Ensure only the service user can read the config
chown aiqwhisper:aiqwhisper /opt/aiqwhisper/.env
chown aiqwhisper:aiqwhisper /opt/aiqwhisper/data/aiqwhisper.db
```

### 10.7 Firewall Rules

```bash
# Allow only HTTPS (via nginx) from trusted networks
sudo ufw allow from 10.0.0.0/8 to any port 443
sudo ufw deny 3080

# Allow outbound HTTPS to storage systems
sudo ufw allow out to any port 443
sudo ufw allow out to any port 8443
```

### 10.8 Disable Auto-Learning in Air-Gapped Environments

If your environment has no internet access, disable auto-learning to prevent unnecessary connection attempts:

```ini
AUTO_LEARN_ENABLED=false
```

---

## Next Steps

- **[API Reference](API_REFERENCE.md)** — Full REST API documentation
- **[Use Cases](USE_CASES.md)** — Detailed use case workflows
- **[Comparison](COMPARISON.md)** — AIQwhisper vs AIQUM feature comparison

---

<p align="center">
  <sub>AIQwhisper v2.0.0 — Installation Guide</sub>
</p>
