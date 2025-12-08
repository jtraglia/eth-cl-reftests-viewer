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

# Check for required dependencies
if ! command -v node &> /dev/null; then
  echo "Error: 'node' is not installed."
  echo "Please install Node.js: https://nodejs.org/"
  exit 1
fi

if ! command -v uv &> /dev/null; then
  echo "Error: 'uv' is not installed."
  echo "Please install uv: https://docs.astral.sh/uv/getting-started/installation/"
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

# Special handling for v1.6.0 - use specific commit with ssz-debug-tools changes
if [ "$VERSION" = "v1.6.0" ]; then
  COMMIT="ab09e2e94fb61bc8cf3a24747db0473c2405b2ca"

  # Fetch master branch to get the latest commits (commit is on master)
  echo "Fetching master branch from origin..."
  git fetch origin master

  echo "Checking out commit $COMMIT..."
  if ! git checkout "$COMMIT"; then
    echo ""
    echo "Error: Failed to checkout commit $COMMIT"
    exit 1
  fi
else
  # For other versions, fetch tags and checkout the tag
  echo "Fetching tags from origin..."
  git fetch origin --tags

  echo "Checking out tag $VERSION..."
  if ! git checkout "$VERSION" 2>/dev/null; then
    echo ""
    echo "Error: Tag '$VERSION' not found."
    echo ""
    echo "Available tags matching '$VERSION':"
    git tag -l "*${VERSION}*" | head -20
    echo ""
    echo "Recent tags (last 20):"
    git tag -l "v*" | grep -E "^v[0-9]+\.[0-9]+\.[0-9]+" | sort -V | tail -20
    exit 1
  fi
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
