<p align="center">
  <h1 align="center">🔮 AIQwhisper</h1>
  <p align="center"><strong>On-Premises NetApp Infrastructure Manager</strong></p>
  <p align="center">
    A standalone, self-contained alternative to NetApp Active IQ Unified Manager.<br/>
    Monitor ONTAP, StorageGRID &amp; E-Series — no cloud, no Java, no external database.
  </p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18.0.0-green" alt="Node.js">
  <img src="https://img.shields.io/badge/database-SQLite-blue" alt="SQLite">
  <img src="https://img.shields.io/badge/license-Proprietary-red" alt="License">
  <img src="https://img.shields.io/badge/platforms-ONTAP%20%7C%20StorageGRID%20%7C%20E--Series-orange" alt="Platforms">
</p>

---

## What is AIQwhisper?

AIQwhisper is a **lightweight, self-contained infrastructure management tool** that connects directly to your on-premises NetApp storage systems — **ONTAP clusters**, **StorageGRID grids**, and **E-Series arrays** — via their native REST APIs. It collects configuration, health, performance, and capacity data into a local **SQLite database**, then runs automated best-practice analysis to surface issues, recommendations, and remediation actions.

Think of it as **your own private Active IQ Unified Manager** — without the heavyweight Java VM, external MySQL/PostgreSQL database, dedicated server requirements, or cloud connectivity.

### Key Differentiators

| Feature | AIQwhisper | AIQUM |
|---------|-----------|-------|
| **Install** | `npm install && npm start` | 30+ min install, dedicated VM, Java, DB |
| **Footprint** | ~50 MB + SQLite | 8 GB+ RAM, 150 GB+ disk |
| **Database** | Embedded SQLite (zero config) | External MySQL/PostgreSQL required |
| **Platforms** | ONTAP + StorageGRID + **E-Series** | ONTAP only (StorageGRID via Unified Manager) |
| **Performance History** | 6-month retention with tiered rollups | 6-month (requires dedicated resources) |
| **Capacity Projections** | Built-in linear regression with confidence scoring | Basic days-to-full |
| **Auto-Learning** | Polls public NetApp docs for release/EOL updates | Requires cloud connectivity |
| **MSP Reporting** | Health scorecards, firmware currency, export | Limited without cloud features |
| **Extensibility** | Full REST API, modular architecture | REST API available |
| **Cloud Dependency** | **None** — fully air-gapped capable | Recommends cloud connection |
| **Cost** | Proprietary license | Included with NetApp support contract |
| **Open Architecture** | Node.js — easy to customize | Java — complex to customize |

> **See [docs/COMPARISON.md](docs/COMPARISON.md) for a detailed feature comparison.**

---

## Features

### 🔍 Multi-Platform Discovery & Inventory
- **ONTAP**: Clusters, nodes, aggregates, volumes, SVMs, LIFs, disks, shelves, LUNs, exports, CIFS shares, igroups, SnapMirror relationships
- **StorageGRID**: Grid topology, nodes, S3 buckets, ILM policies, storage pools, EC profiles, alerts, users/groups
- **E-Series**: Storage arrays, controllers, drives, pools, volume groups, volumes, hosts, LUN mappings, interfaces, SSD cache

### 📊 Deep Performance Monitoring
- **30+ ONTAP counter tables**: system, volume, aggregate, LUN, disk, processor, WAFL, ports, protocol-specific (NFS/CIFS/iSCSI/FCP/NVMe), QoS, FlashCache
- **StorageGRID metrics**: S3 ops/sec, ingest/retrieve rates, per-node CPU/memory/disk, ILM queue depth
- **E-Series analysed statistics**: Volume, controller, drive, system, and interface metrics

### 🗄️ 6-Month Historical Data
- **Tiered rollup architecture**: Raw (5-min, 7-day) → Hourly (30-day) → Daily (6-month) → Weekly (12-month)
- **Statistical aggregations**: min, max, avg, p95, p99, sample count
- **Efficient storage**: ~300-500 MB for 100 resources over 6 months

### 🧠 Auto-Learning Engine
- Polls `endoflife.date` public API for ONTAP/StorageGRID/E-Series lifecycle data
- Scrapes NetApp documentation for release notes and security advisories
- Automatically detects when your systems are running EOL software
- Updates best-practice rules when new versions/advisories are published

### 📈 Capacity Planning & Projections
- Linear regression on historical capacity data
- **Days-to-full** calculations at 85%, 90%, 95%, 100% thresholds
- Growth rate trending (daily/weekly/monthly)
- **R² confidence scoring** — know how reliable your projections are
- Right-sizing analysis (over-provisioned and under-provisioned resources)

### 🏥 Health Scoring
- Composite 0-100 health score per system
- Weighted factors: issues, capacity, software currency, data protection, performance, security
- Historical health trend tracking

### 🛡️ Best-Practice Analysis
- **60+ built-in rules** across all three platforms
- Categories: capacity, performance, availability, protection, security, software currency
- Severity levels: Critical, Warning, Informational
- Actionable remediation steps with CLI commands
- NetApp KB article references

### 📋 MSP-Grade Reporting
- Executive health summaries
- Firmware currency reports
- Capacity planning reports
- Issue/recommendation summaries
- Risk heat maps
- License compliance
- Security posture reports

### 🌐 REST API
- Full API for all features — build your own integrations
- CORS enabled — connect from any web application
- JSON responses with consistent error handling

---

## Quick Start

### Prerequisites
- **Node.js 18+** ([download](https://nodejs.org/))
- Network access to your NetApp storage systems
- Credentials for each system (admin or read-only accounts)

### Installation

```bash
# Clone the repository
git clone https://github.com/ebeauzec/AIQwhisper.git
cd AIQwhisper

# Install dependencies
npm install

# Configure
cp .env.example .env
# Edit .env — set MASTER_PASSPHRASE to something secure

# Initialize the database
npm run init-db

# Start the server
npm start
```

### First Steps

1. **Open the web UI**: Navigate to `http://localhost:3080`
2. **Add a system**: Go to Systems → Add System
3. **Choose platform**: Select ONTAP, StorageGRID, or E-Series
4. **Enter credentials**: Hostname, username, password
5. **Test connection**: Click "Test" to verify connectivity
6. **Start collecting**: Click "Collect Now" or wait for the scheduled poll

> **See [docs/INSTALLATION.md](docs/INSTALLATION.md) for detailed setup instructions.**

---

## Configuration

All configuration is done via environment variables (`.env` file):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3080` | HTTP server port |
| `BIND_ADDRESS` | `127.0.0.1` | Bind address (`0.0.0.0` for LAN access) |
| `DB_PATH` | `./data/aiqwhisper.db` | SQLite database path |
| `MASTER_PASSPHRASE` | `changeme` | Encryption key for stored credentials |
| `POLL_INTERVAL_MINUTES` | `15` | Inventory collection interval |
| `PERF_POLL_INTERVAL_MINUTES` | `5` | Performance metrics interval |
| `RETENTION_RAW_DAYS` | `7` | Raw metrics retention |
| `RETENTION_HOURLY_DAYS` | `30` | Hourly rollup retention |
| `RETENTION_DAILY_DAYS` | `180` | Daily rollup retention (6 months) |
| `RETENTION_WEEKLY_DAYS` | `365` | Weekly rollup retention (12 months) |
| `AUTO_LEARN_ENABLED` | `true` | Enable auto-learning from public sources |
| `REJECT_UNAUTHORIZED` | `false` | Accept self-signed SSL certificates |

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│                    Web Browser                    │
│         Dashboard · Inventory · Health           │
│     Performance · Capacity · Issues · Reports    │
└─────────────────────┬────────────────────────────┘
                      │ HTTP (CORS Enabled)
┌─────────────────────▼────────────────────────────┐
│              AIQwhisper Server                    │
│                 (Node.js + Express)               │
│                                                   │
│  ┌─────────┐  ┌──────────┐  ┌─────────────────┐ │
│  │ ONTAP   │  │StorageGRID│  │   E-Series      │ │
│  │Collector│  │ Collector │  │   Collector      │ │
│  └────┬────┘  └─────┬─────┘  └───────┬─────────┘ │
│       │             │                 │           │
│  ┌────▼─────────────▼─────────────────▼────────┐ │
│  │            SQLite Database                   │ │
│  │  Inventory · Metrics · Issues · Knowledge    │ │
│  └────┬────────────────────────────────┬───────┘ │
│       │                                │         │
│  ┌────▼──────────┐  ┌─────────────────▼───────┐ │
│  │ Rules Engine  │  │  Auto-Learning Engine    │ │
│  │ Health Score  │  │  endoflife.date API      │ │
│  │ Projections   │  │  NetApp Documentation    │ │
│  └───────────────┘  └─────────────────────────┘ │
└──────────────────────────────────────────────────┘
         │              │              │
   ┌─────▼─────┐  ┌────▼─────┐  ┌────▼──────┐
   │  ONTAP    │  │StorageGRID│  │ E-Series  │
   │  Cluster  │  │   Grid   │  │  Array    │
   │ /api/*    │  │/api/v4/* │  │/devmgr/v2│
   └───────────┘  └──────────┘  └───────────┘
```

---

## API Reference

> **See [docs/API_REFERENCE.md](docs/API_REFERENCE.md) for the complete API documentation.**

### Quick Overview

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Server health status |
| `/api/systems` | GET, POST | List/register storage systems |
| `/api/systems/:id` | GET, PUT, DELETE | System CRUD |
| `/api/systems/:id/test` | POST | Test connectivity |
| `/api/systems/:id/collect` | POST | Trigger collection |
| `/api/dashboard/summary` | GET | Aggregated dashboard data |
| `/api/inventory/:resource` | GET | Inventory by resource type |
| `/api/issues` | GET | All detected issues |
| `/api/recommendations` | GET | Best-practice recommendations |
| `/api/events` | GET | Unified event log |
| `/api/performance/:id/:type` | GET | Performance metrics with time range |
| `/api/capacity/projections` | GET | Capacity runway projections |
| `/api/reports/generate` | POST | Generate MSP reports |
| `/api/learning/status` | GET | Auto-learner status |
| `/api/learning/update` | POST | Trigger learning update |

---

## Use Cases

> **See [docs/USE_CASES.md](docs/USE_CASES.md) for detailed use case documentation.**

- **MSP Fleet Management** — Monitor dozens of customer environments from one dashboard
- **Air-Gapped Environments** — Full functionality without internet connectivity
- **Capacity Planning** — Proactive runway analysis with growth projections
- **Compliance Auditing** — Software currency, security posture, license compliance
- **Incident Investigation** — Historical performance data for root cause analysis
- **Upgrade Planning** — Know which systems need upgrades before EOL dates hit
- **Executive Reporting** — One-click health scorecards for management presentations

---

## Supported Platforms

| Platform | API | Auth | Min Version |
|----------|-----|------|-------------|
| **NetApp ONTAP** | REST API (`/api/*`) | Basic Auth, OAuth 2.0, Certificate | ONTAP 9.6+ |
| **NetApp StorageGRID** | Grid Management API (`/api/v4/*`) | Bearer Token | StorageGRID 11.6+ |
| **NetApp E-Series** | SANtricity Web Services (`/devmgr/v2/*`) | Basic Auth | SANtricity 11.60+ |

---

## Project Structure

```
AIQwhisper/
├── .env.example           # Configuration template
├── .gitignore
├── LICENSE                # Proprietary license
├── README.md              # This file
├── package.json
├── docs/                  # Documentation
│   ├── COMPARISON.md      # AIQwhisper vs AIQUM
│   ├── INSTALLATION.md    # Detailed installation guide
│   ├── API_REFERENCE.md   # Complete API documentation
│   └── USE_CASES.md       # Use case documentation
├── data/                  # SQLite database (gitignored)
├── public/                # Web UI
│   ├── index.html
│   ├── css/index.css
│   └── js/
│       ├── app.js
│       ├── views/         # Dashboard, Inventory, Issues, etc.
│       └── components/    # Charts, Tables, Timeline
└── src/                   # Backend
    ├── index.js           # Server entry point
    ├── config.js          # Configuration
    ├── db/                # Database layer
    ├── collectors/        # Platform collectors
    ├── scheduler/         # Job scheduling
    ├── analysis/          # Rules engine, projections, auto-learner
    ├── routes/            # API routes
    ├── middleware/        # CORS, logging, error handling
    └── utils/             # Crypto, HTTP client, logging, regression
```

---

## Contributing

This is a proprietary project. Please see the [LICENSE](LICENSE) file for terms. Contributions are welcome by invitation only.

---

## Disclaimer

AIQwhisper is an independent project and is **not affiliated with, endorsed by, or sponsored by NetApp, Inc.** NetApp, ONTAP, StorageGRID, E-Series, SANtricity, Active IQ, and Active IQ Unified Manager are trademarks of NetApp, Inc. The use of NetApp APIs is subject to NetApp's own terms of service.

---

<p align="center">
  <sub>Built with ❤️ for storage infrastructure teams who deserve better tools.</sub>
</p>
