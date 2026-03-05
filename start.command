#!/bin/bash
cd "$(dirname "$0")"

if ! command -v node &>/dev/null; then
  echo "Node.js is not installed."
  echo "Install it from https://nodejs.org or run: brew install node"
  echo ""
  read -p "Press Enter to close..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run)..."
  npm install
fi

echo "Starting HEKounter..."
echo "Opening http://localhost:5173 in your browser..."
echo ""

sleep 1 && open "http://localhost:5173" &

npm run dev
