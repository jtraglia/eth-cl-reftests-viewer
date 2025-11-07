#!/bin/bash

# Check for new consensus-specs versions and download them
#
# This script:
# - Fetches latest tags from ethereum/consensus-specs
# - Finds versions newer than v1.6.0
# - Downloads and processes any new versions
#
# Designed to run hourly via cron

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

MIN_VERSION="v1.6.0"
LOGFILE="check-new-versions.log"

echo "[$(date)] Checking for new consensus-specs versions..." | tee -a "$LOGFILE"

# Create a temporary directory for git operations
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Clone just the tags (shallow)
cd "$TEMP_DIR"
git clone --bare --filter=blob:none https://github.com/ethereum/consensus-specs.git repo
cd repo

# Get all version tags (v*.*.*)
ALL_TAGS=$(git tag -l "v*.*.*" | sort -V)

# Filter to get only versions newer than MIN_VERSION
NEW_TAGS=""
FOUND_MIN=false
for tag in $ALL_TAGS; do
  if [ "$tag" = "$MIN_VERSION" ]; then
    FOUND_MIN=true
    continue
  fi
  if [ "$FOUND_MIN" = true ]; then
    NEW_TAGS="$NEW_TAGS $tag"
  fi
done

if [ -z "$NEW_TAGS" ]; then
  echo "[$(date)] No new versions found (latest processed: $MIN_VERSION)" | tee -a "$SCRIPT_DIR/$LOGFILE"
  exit 0
fi

echo "[$(date)] Found new versions:$NEW_TAGS" | tee -a "$SCRIPT_DIR/$LOGFILE"

# Go back to script directory
cd "$SCRIPT_DIR"

# Process each new version
for version in $NEW_TAGS; do
  echo "[$(date)] Processing $version..." | tee -a "$LOGFILE"

  # Check if already downloaded
  if [ -d "data/$version" ]; then
    echo "[$(date)] $version already exists, skipping..." | tee -a "$LOGFILE"
    continue
  fi

  # Download and process
  echo "[$(date)] Downloading $version..." | tee -a "$LOGFILE"
  if ./download.sh "$version" 2>&1 | tee -a "$LOGFILE"; then
    echo "[$(date)] Successfully processed $version" | tee -a "$LOGFILE"
  else
    echo "[$(date)] ERROR: Failed to process $version" | tee -a "$LOGFILE"
  fi
done

echo "[$(date)] Check complete" | tee -a "$LOGFILE"
