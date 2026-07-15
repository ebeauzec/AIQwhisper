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
            exit 1
            ;;
    esac

    NODE_TARBALL="node-v${NODE_VERSION}-${PLATFORM}-${NODE_ARCH}.tar.gz"
    NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TARBALL}"
    TEMP_DIR=$(mktemp -d)

    echo "        Downloading Node.js v${NODE_VERSION} for ${PLATFORM}-${NODE_ARCH}..."

    if command -v curl &> /dev/null; then
        curl -fSL --progress-bar -o "$TEMP_DIR/$NODE_TARBALL" "$NODE_URL"
    elif command -v wget &> /dev/null; then
        wget -q --show-progress -O "$TEMP_DIR/$NODE_TARBALL" "$NODE_URL"
    else
        echo -e "${RED}[ERROR]${NC} Neither curl nor wget found."
        exit 1
    fi

    echo -e "${GREEN}[OK]${NC} Download complete."
    echo -e "${YELLOW}[SETUP]${NC} Extracting Node.js runtime..."

    mkdir -p "$RUNTIME_DIR"
    tar xzf "$TEMP_DIR/$NODE_TARBALL" -C "$TEMP_DIR"
    cp -r "$TEMP_DIR/node-v${NODE_VERSION}-${PLATFORM}-${NODE_ARCH}/"* "$RUNTIME_DIR/"
    rm -rf "$TEMP_DIR"

    if [ -x "$RUNTIME_DIR/bin/node" ]; then
        NODE_CMD="$RUNTIME_DIR/bin/node"
        NPM_CMD="$RUNTIME_DIR/bin/npm"
        echo -e "${GREEN}[OK]${NC} Node.js v${NODE_VERSION} installed to runtime/ directory."
    else
        echo -e "${RED}[ERROR]${NC} Node.js installation failed."
        exit 1
    fi
fi

# -------------------------------------------------------
# 2. Install dependencies if needed
# -------------------------------------------------------
if [ ! -d "$SCRIPT_DIR/node_modules/express" ]; then
    echo ""
    echo -e "${YELLOW}[SETUP]${NC} Installing dependencies... (first run only, may take a minute)"
    echo ""

    # Install to a LOCAL temp directory first to avoid cloud-sync
    # file-locking issues (Google Drive, iCloud Drive, Dropbox, etc.)
    INSTALL_DIR=$(mktemp -d)
    cp "$SCRIPT_DIR/package.json" "$INSTALL_DIR/package.json"
    [ -f "$SCRIPT_DIR/package-lock.json" ] && cp "$SCRIPT_DIR/package-lock.json" "$INSTALL_DIR/package-lock.json"

    # Run npm install in the local temp directory (no sync interference)
    cd "$INSTALL_DIR"
    "$NPM_CMD" install --production
    if [ $? -ne 0 ]; then
        echo ""
        echo -e "${RED}[ERROR]${NC} npm install failed. Check your internet connection."
        rm -rf "$INSTALL_DIR"
        exit 1
    fi

    # Copy node_modules back to the project
    echo -e "${YELLOW}[SETUP]${NC} Copying dependencies to project..."
    rm -rf "$SCRIPT_DIR/node_modules" 2>/dev/null
    cp -r "$INSTALL_DIR/node_modules" "$SCRIPT_DIR/node_modules"

    # Copy lock file back
    [ -f "$INSTALL_DIR/package-lock.json" ] && cp "$INSTALL_DIR/package-lock.json" "$SCRIPT_DIR/package-lock.json"

    # Clean up temp
    rm -rf "$INSTALL_DIR"

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
# 5. Start the application (browser opens automatically)
# -------------------------------------------------------
echo ""
echo "============================================"
echo -e " ${BOLD}Starting AIQwhisper...${NC}"
echo -e " Dashboard will open in your browser."
echo " Press Ctrl+C to stop"
echo "============================================"
echo ""

cd "$SCRIPT_DIR"
"$NODE_CMD" src/index.js
