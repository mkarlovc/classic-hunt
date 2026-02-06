#!/bin/bash

# Classic Hunt - Setup Script
# Installs dependencies and configures launchd scheduled tasks

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENTS_DIR="$HOME/Library/LaunchAgents"

SCRAPE_PLIST="com.classic-hunt.scrape.plist"
EMAIL_PLIST="com.classic-hunt.email.plist"
OLD_PLIST="com.classic-hunt.daily.plist"

echo "Classic Hunt - Setup"
echo "===================="
echo ""

# Create directories
mkdir -p "$SCRIPT_DIR/logs"
mkdir -p "$SCRIPT_DIR/reports"
mkdir -p "$SCRIPT_DIR/output"
echo "[OK] Created directories"

# Install dependencies
echo "[..] Installing npm dependencies..."
cd "$SCRIPT_DIR"
npm install
echo "[OK] Dependencies installed"

# Find node path
NODE_PATH=$(which node)
echo "[OK] Found node at: $NODE_PATH"

# Unload old plist if it exists
if [ -f "$AGENTS_DIR/$OLD_PLIST" ]; then
  launchctl unload "$AGENTS_DIR/$OLD_PLIST" 2>/dev/null || true
  rm -f "$AGENTS_DIR/$OLD_PLIST"
  echo "[OK] Removed old daily plist"
fi

# Install scrape plist (every 30 minutes)
sed "s|/usr/local/bin/node|$NODE_PATH|g" "$SCRIPT_DIR/$SCRAPE_PLIST" > "$AGENTS_DIR/$SCRAPE_PLIST"
launchctl unload "$AGENTS_DIR/$SCRAPE_PLIST" 2>/dev/null || true
launchctl load "$AGENTS_DIR/$SCRAPE_PLIST"
echo "[OK] Installed scrape agent (every 30 min)"

# Install email plist (daily at noon)
sed "s|/usr/local/bin/node|$NODE_PATH|g" "$SCRIPT_DIR/$EMAIL_PLIST" > "$AGENTS_DIR/$EMAIL_PLIST"
launchctl unload "$AGENTS_DIR/$EMAIL_PLIST" 2>/dev/null || true
launchctl load "$AGENTS_DIR/$EMAIL_PLIST"
echo "[OK] Installed email agent (daily at 12:00)"

echo ""
echo "Setup complete!"
echo ""
echo "Schedule:"
echo "  Scrape + Summarize:  every 30 minutes"
echo "  Email report:        daily at 12:00"
echo ""
echo "IMPORTANT: Configure config.json before first run:"
echo "  - smtpUser: Your Gmail address"
echo "  - smtpPass: App password (https://myaccount.google.com/apppasswords)"
echo ""
echo "Commands:"
echo "  npm start              - Full pipeline (scrape + visualize + summarize + email)"
echo "  npm run scrape         - Scraper only"
echo "  npm run summarize      - LLM summary + picks only"
echo "  npm run email          - Send email only"
echo "  npm run visualize      - Generate HTML visualization"
echo ""
echo "Cron management:"
echo "  launchctl list | grep classic-hunt    - Check status"
echo "  launchctl unload ~/Library/LaunchAgents/$SCRAPE_PLIST  - Stop scraping"
echo "  launchctl unload ~/Library/LaunchAgents/$EMAIL_PLIST   - Stop email"
echo "  bash setup.sh                         - Reinstall everything"
echo ""
echo "Logs:"
echo "  tail -f $SCRIPT_DIR/logs/scrape.log"
echo "  tail -f $SCRIPT_DIR/logs/email.log"
