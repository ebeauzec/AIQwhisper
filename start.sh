#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'
YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNTIME_DIR="$SCRIPT_DIR/runtime"
NODE_VERSION="22.16.0"
NODE_CMD="" ; NPM_CMD="" ; APP_PORT=3000

echo ""
echo -e "${CYAN}    _    ___ ___           _     _                   ${NC}"
echo -e "${CYAN}   / \\  |_ _/ _ \\__      _| |__ (_)___ _ __   ___ _ __ ${NC}"
echo -e "${CYAN}  / _ \\  | | | | \\ \\ /\\ / / '_ \\| / __| '_ \\ / _ \\ '__|${NC}"
echo -e "${CYAN} / ___ \\ | | |_| |\\ V  V /| | | | \\__ \\ |_) |  __/ |   ${NC}"
echo -e "${CYAN}/_/   \\_\\___\\__\\_\\ \\_/\\_/ |_| |_|_|___/ .__/ \\___|_|   ${NC}"
echo -e "${CYAN}                                       |_|              ${NC}"
echo ""
echo -e "${BOLD} On-Premises NetApp Infrastructure Manager${NC}"
echo " =========================================="
echo ""

# Read port from .env
[ -f "$SCRIPT_DIR/.env" ] && {
    _p=$(grep -E '^PORT=' "$SCRIPT_DIR/.env" 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')
    [ -n "$_p" ] && APP_PORT="$_p"
}

# ===============================================================
#  STEP 1 — Locate or install Node.js
# ===============================================================

if [ -x "$RUNTIME_DIR/bin/node" ]; then
    NODE_CMD="$RUNTIME_DIR/bin/node"
    NPM_CMD="$RUNTIME_DIR/bin/npm"
    echo -e "${GREEN}[OK]${NC} Bundled Node.js runtime found."
elif command -v node &>/dev/null; then
    _v=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$_v" -ge 18 ] 2>/dev/null; then
        NODE_CMD="node" ; NPM_CMD="npm"
        echo -e "${GREEN}[OK]${NC} System Node.js found (v$_v)."
    else
        echo -e "${YELLOW}[WARN]${NC} System Node.js too old (v$_v, need 18+)."
    fi
fi

if [ -z "$NODE_CMD" ]; then
    echo ""
    echo -e "${YELLOW}[SETUP]${NC} Downloading Node.js v${NODE_VERSION}... (one-time, ~25 MB)"
    OS=$(uname -s) ; ARCH=$(uname -m)
    case "$OS"   in Darwin) PLAT=darwin ;; Linux) PLAT=linux ;; *) echo -e "${RED}[ERROR]${NC} Unsupported OS: $OS"; exit 1 ;; esac
    case "$ARCH" in x86_64|amd64) NA=x64 ;; aarch64|arm64) NA=arm64 ;; armv7l) NA=armv7l ;; *) echo -e "${RED}[ERROR]${NC} Unsupported arch: $ARCH"; exit 1 ;; esac
    TAR="node-v${NODE_VERSION}-${PLAT}-${NA}.tar.gz"
    URL="https://nodejs.org/dist/v${NODE_VERSION}/${TAR}"
    TMP=$(mktemp -d)
    curl -fSL --progress-bar -o "$TMP/$TAR" "$URL" || wget -q --show-progress -O "$TMP/$TAR" "$URL" || { echo -e "${RED}[ERROR]${NC} Download failed."; exit 1; }
    mkdir -p "$RUNTIME_DIR" && tar xzf "$TMP/$TAR" -C "$TMP"
    cp -r "$TMP/node-v${NODE_VERSION}-${PLAT}-${NA}/"* "$RUNTIME_DIR/" && rm -rf "$TMP"
    [ -x "$RUNTIME_DIR/bin/node" ] && { NODE_CMD="$RUNTIME_DIR/bin/node"; NPM_CMD="$RUNTIME_DIR/bin/npm"; echo -e "${GREEN}[OK]${NC} Node.js v${NODE_VERSION} installed."; } \
        || { echo -e "${RED}[ERROR]${NC} Extraction failed."; exit 1; }
fi

# Ensure node is on PATH for native module builds
[ -x "$RUNTIME_DIR/bin/node" ] && export PATH="$RUNTIME_DIR/bin:$PATH"

# ===============================================================
#  STEP 2 — Install dependencies (to local filesystem)
# ===============================================================
if [ "$(uname -s)" = "Darwin" ]; then
    LOCAL_DIR="$HOME/Library/Application Support/AIQwhisper"
else
    LOCAL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/AIQwhisper"
fi
mkdir -p "$LOCAL_DIR"

if [ ! -f "$LOCAL_DIR/node_modules/express/package.json" ]; then
    echo ""
    echo -e "${YELLOW}[SETUP]${NC} Installing dependencies... (first run, ~30 seconds)"
    cp -f "$SCRIPT_DIR/package.json" "$LOCAL_DIR/package.json"
    [ -f "$SCRIPT_DIR/package-lock.json" ] && cp -f "$SCRIPT_DIR/package-lock.json" "$LOCAL_DIR/package-lock.json"
    cd "$LOCAL_DIR" && "$NPM_CMD" install --production || { echo -e "${RED}[ERROR]${NC} npm install failed."; exit 1; }
    echo -e "${GREEN}[OK]${NC} Dependencies installed."
else
    echo -e "${GREEN}[OK]${NC} Dependencies ready."
fi

export NODE_PATH="$LOCAL_DIR/node_modules"

# ===============================================================
#  STEP 3 — Create config / data dirs if missing
# ===============================================================
[ ! -f "$SCRIPT_DIR/.env" ] && [ -f "$SCRIPT_DIR/.env.example" ] && {
    cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
    echo -e "${GREEN}[OK]${NC} Default .env created."
}
mkdir -p "$SCRIPT_DIR/data"

# ===============================================================
#  STEP 4 — Kill any previous instance
# ===============================================================
if command -v lsof &>/dev/null; then
    _pid=$(lsof -ti :"$APP_PORT" 2>/dev/null || true)
    [ -n "$_pid" ] && {
        echo -e "${YELLOW}[WARN]${NC} Stopping previous instance (PID $_pid) on port $APP_PORT..."
        kill $_pid 2>/dev/null || true ; sleep 2
    }
fi

# ===============================================================
#  STEP 5 — Launch
# ===============================================================
echo ""
echo "============================================"
echo -e "  ${BOLD}AIQwhisper starting on port ${APP_PORT}${NC}"
echo "  Browser will open automatically"
echo "  Press Ctrl+C to stop"
echo "============================================"
echo ""

cd "$SCRIPT_DIR"
exec "$NODE_CMD" src/index.js
