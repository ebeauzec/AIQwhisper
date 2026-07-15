#!/usr/bin/env bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNTIME_DIR="$SCRIPT_DIR/runtime"
NODE_CMD=""
NPM_CMD=""
NODE_VERSION="22.16.0"

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
# 1. Find or install Node.js
# -------------------------------------------------------

# Option A: Check for bundled runtime
if [ -x "$RUNTIME_DIR/bin/node" ]; then
    NODE_CMD="$RUNTIME_DIR/bin/node"
    NPM_CMD="$RUNTIME_DIR/bin/npm"
    echo -e "${GREEN}[OK]${NC} Using bundled Node.js runtime."

# Option B: Check for system-wide Node.js 18+
elif command -v node &> /dev/null; then
    SYS_VER=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$SYS_VER" -ge 18 ] 2>/dev/null; then
        NODE_CMD="node"
        NPM_CMD="npm"
        echo -e "${GREEN}[OK]${NC} System Node.js found: $(node -v)"
    else
        echo -e "${YELLOW}[WARN]${NC} System Node.js is too old: v${SYS_VER} (need 18+)"
    fi
fi

# Option C: Auto-download portable Node.js
if [ -z "$NODE_CMD" ]; then
    echo ""
    echo -e "${YELLOW}[SETUP]${NC} Node.js not found. Downloading portable runtime..."
    echo "        This is a one-time download (~25 MB)."
    echo ""

    # Detect OS and architecture
    OS="$(uname -s)"
    ARCH="$(uname -m)"

    case "$OS" in
        Darwin) PLATFORM="darwin" ;;
        Linux)  PLATFORM="linux" ;;
        *)
            echo -e "${RED}[ERROR]${NC} Unsupported OS: $OS"
            echo "        Please install Node.js 18+ manually: https://nodejs.org/"
            exit 1
            ;;
    esac

    case "$ARCH" in
        x86_64|amd64)   NODE_ARCH="x64" ;;
        aarch64|arm64)  NODE_ARCH="arm64" ;;
        armv7l)         NODE_ARCH="armv7l" ;;
        *)
            echo -e "${RED}[ERROR]${NC} Unsupported architecture: $ARCH"
            echo "        Please install Node.js 18+ manually: https://nodejs.org/"
            exit 1
            ;;
    esac

    NODE_TARBALL="node-v${NODE_VERSION}-${PLATFORM}-${NODE_ARCH}.tar.gz"
    NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TARBALL}"
    TEMP_DIR=$(mktemp -d)

    echo "        Downloading Node.js v${NODE_VERSION} for ${PLATFORM}-${NODE_ARCH}..."
    echo "        URL: ${NODE_URL}"
    echo ""

    # Download using curl or wget
    if command -v curl &> /dev/null; then
        curl -fSL --progress-bar -o "$TEMP_DIR/$NODE_TARBALL" "$NODE_URL"
    elif command -v wget &> /dev/null; then
        wget -q --show-progress -O "$TEMP_DIR/$NODE_TARBALL" "$NODE_URL"
    else
        echo -e "${RED}[ERROR]${NC} Neither curl nor wget found. Please install Node.js manually."
        exit 1
    fi

    echo -e "${GREEN}[OK]${NC} Download complete."
    echo -e "${YELLOW}[SETUP]${NC} Extracting Node.js runtime..."

    # Extract to runtime directory
    mkdir -p "$RUNTIME_DIR"
    tar xzf "$TEMP_DIR/$NODE_TARBALL" -C "$TEMP_DIR"
    cp -r "$TEMP_DIR/node-v${NODE_VERSION}-${PLATFORM}-${NODE_ARCH}/"* "$RUNTIME_DIR/"

    # Clean up
    rm -rf "$TEMP_DIR"

    if [ -x "$RUNTIME_DIR/bin/node" ]; then
        NODE_CMD="$RUNTIME_DIR/bin/node"
        NPM_CMD="$RUNTIME_DIR/bin/npm"
        echo -e "${GREEN}[OK]${NC} Node.js v${NODE_VERSION} installed to runtime/ directory."
    else
        echo -e "${RED}[ERROR]${NC} Node.js installation failed."
        echo "        Please install Node.js 18+ manually: https://nodejs.org/"
        exit 1
    fi
fi

# -------------------------------------------------------
# 2. Install dependencies if needed
# -------------------------------------------------------
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
    echo ""
    echo -e "${YELLOW}[SETUP]${NC} Installing dependencies... (first run only, may take a minute)"
    echo ""

    # Use a local temp cache to avoid file-locking issues on synced
    # filesystems (Google Drive, OneDrive, Dropbox, iCloud, etc.)
    NPM_CACHE="${TMPDIR:-/tmp}/aiqwhisper-npm-cache"
    mkdir -p "$NPM_CACHE"

    cd "$SCRIPT_DIR"
    if ! "$NPM_CMD" install --production --cache "$NPM_CACHE" 2>&1; then
        echo ""
        echo -e "${YELLOW}[WARN]${NC} First install attempt failed. Retrying with clean cache..."
        "$NPM_CMD" cache clean --force --cache "$NPM_CACHE" 2>/dev/null
        if ! "$NPM_CMD" install --production --cache "$NPM_CACHE" 2>&1; then
            echo ""
            echo -e "${RED}[ERROR]${NC} npm install failed. If running from a cloud-synced folder"
            echo "        (Google Drive, OneDrive, Dropbox, iCloud), try one of:"
            echo ""
            echo "  1. Pause file sync, then run ./start.sh again"
            echo "  2. Copy this folder to a local path and run from there:"
            echo "     cp -r . ~/AIQwhisper && cd ~/AIQwhisper && ./start.sh"
            echo ""
            exit 1
        fi
    fi
    echo ""
    echo -e "${GREEN}[OK]${NC} Dependencies installed."
else
    echo -e "${GREEN}[OK]${NC} Dependencies already installed."
fi

# -------------------------------------------------------
# 3. Create .env from template if needed
# -------------------------------------------------------
if [ ! -f "$SCRIPT_DIR/.env" ]; then
    echo ""
    echo -e "${YELLOW}[SETUP]${NC} Creating default configuration..."
    cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
    echo -e "${GREEN}[OK]${NC} Configuration created at .env"
    echo "     Edit .env to customize settings before adding systems."
else
    echo -e "${GREEN}[OK]${NC} Configuration file found."
fi

# -------------------------------------------------------
# 4. Create data directory if needed
# -------------------------------------------------------
if [ ! -d "$SCRIPT_DIR/data" ]; then
    mkdir -p "$SCRIPT_DIR/data"
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

cd "$SCRIPT_DIR"
"$NODE_CMD" src/index.js
