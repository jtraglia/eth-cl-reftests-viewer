#!/bin/bash

# Download and prepare Ethereum consensus specs tests
#
# Usage: ./download.sh <version>
# Example: ./download.sh v1.6.0

set -e  # Exit on error

if [ $# -lt 1 ]; then
  echo "Usage: ./download.sh <version>"
  echo "Example: ./download.sh v1.6.0"
  exit 1
fi

VERSION=$1
LOGFILE="output_${VERSION}.txt"

# Redirect all output to logfile and terminal
exec > >(tee -a "$LOGFILE") 2>&1

echo "========================================"
echo "Ethereum Consensus Specs Test Downloader"
echo "========================================"
echo ""
echo "Version: $VERSION"
echo "Logfile: $LOGFILE"
echo ""

# Initialize consensus-specs submodule if not already initialized
echo "Initializing consensus-specs submodule..."
git submodule update --init --recursive consensus-specs

# Change to consensus-specs directory
cd consensus-specs

# Fetch latest tags from origin
echo "Fetching tags from origin..."
git fetch origin --tags

# Try to checkout the specified tag
echo "Checking out tag $VERSION..."
if ! git checkout "$VERSION" 2>/dev/null; then
  echo ""
  echo "Error: Tag '$VERSION' not found."
  echo ""
  echo "Available tags matching '$VERSION':"
  git tag -l "*${VERSION}*" | head -20
  echo ""
  echo "Recent tags:"
  git tag -l | sort -V | tail -20
  exit 1
fi

# Clean previous build
echo "Cleaning previous build..."
make clean

# Build pyspec
echo "Building pyspec..."
make _pyspec

# Return to root directory
cd ..

# Run prepare script
echo ""
echo "Running prepare script..."
node scripts/prepare.js "$VERSION"

echo ""
echo "✓ All done!"
echo ""
echo "You can now rebuild the Docker image:"
echo "  docker-compose down"
echo "  docker-compose up --build -d"
