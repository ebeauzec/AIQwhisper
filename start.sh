#!/usr/bin/env bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo ""
echo -e "${CYAN}    _    ___ ___           _     _                   ${NC}"
echo -e "${CYAN}   / \  |_ _/ _ \__      _| |__ (_)___ _ __   ___ _ __ ${NC}"
echo -e "${CYAN}  / _ \  | | | | \ \ /\ / / '_ \| / __| '_ \ / _ \ '__|${NC}"
echo -e "${CYAN} / ___ \ | | |_| |\ V  V /| | | | \__ \ |_) |  __/ |   ${NC}"
echo -e "${CYAN}/_/   \_\___\__\_\ \_/\_/ |_| |_|_|___/ .__/ \___|_|   ${NC}"
echo -e "${CYAN}                                       |_|              ${NC}"
echo ""
echo -e "${BOLD} On-Premises NetApp Infrastructure Manager${NC}"
echo " =========================================="
echo ""

# -------------------------------------------------------
# 1. Check for Node.js
# -------------------------------------------------------
if ! command -v node &> /dev/null; then
    echo -e "${RED}[ERROR]${NC} Node.js is not installed or not in your PATH."
    echo ""
    echo "  Install Node.js 18+ using one of these methods:"
    echo ""
    echo "  macOS (Homebrew):"
    echo "    brew install node@22"
    echo ""
    echo "  macOS (installer):"
    echo "    Download from https://nodejs.org/"
    echo ""
    echo "  Linux (Ubuntu/Debian):"
    echo "    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
    echo "    sudo apt-get install -y nodejs"
    echo ""
    echo "  Linux (RHEL/CentOS):"
    echo "    curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -"
    echo "    sudo yum install -y nodejs"
    echo ""
    echo "  After installing, run this script again."
    exit 1
fi

# Check Node.js version (need 18+)
NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
    echo -e "${RED}[ERROR]${NC} Node.js 18+ is required. You have: $(node -v)"
    echo "  Please upgrade from: https://nodejs.org/"
    exit 1
fi

echo -e "${GREEN}[OK]${NC} Node.js found: $(node -v)"

# -------------------------------------------------------
# 2. Install dependencies if needed
# -------------------------------------------------------
if [ ! -d "node_modules" ]; then
    echo ""
    echo -e "${YELLOW}[SETUP]${NC} Installing dependencies... (first run only)"
    echo ""
    npm install --production
    echo ""
    echo -e "${GREEN}[OK]${NC} Dependencies installed."
else
    echo -e "${GREEN}[OK]${NC} Dependencies already installed."
fi

# -------------------------------------------------------
# 3. Create .env from template if needed
# -------------------------------------------------------
if [ ! -f ".env" ]; then
    echo ""
    echo -e "${YELLOW}[SETUP]${NC} Creating default configuration from .env.example..."
    cp .env.example .env
    echo -e "${GREEN}[OK]${NC} Configuration created at .env"
    echo "     Edit .env to customize settings before adding systems."
else
    echo -e "${GREEN}[OK]${NC} Configuration file found."
fi

# -------------------------------------------------------
# 4. Create data directory if needed
# -------------------------------------------------------
if [ ! -d "data" ]; then
    mkdir -p data
    echo -e "${GREEN}[OK]${NC} Data directory created."
fi

# -------------------------------------------------------
# 5. Start the application
# -------------------------------------------------------
echo ""
echo "============================================"
echo -e " ${BOLD}Starting AIQwhisper...${NC}"
echo -e " Dashboard: ${CYAN}http://localhost:3080${NC}"
echo " Press Ctrl+C to stop"
echo "============================================"
echo ""

node src/index.js
