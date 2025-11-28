#!/bin/bash

# E2E Test Runner Script
# This script starts the test environment and runs Playwright E2E tests

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Default values
TEST_PATTERN=""
HEADED=false
DEBUG=false
KEEP_RUNNING=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --headed)
            HEADED=true
            shift
            ;;
        --debug)
            DEBUG=true
            shift
            ;;
        --keep-running)
            KEEP_RUNNING=true
            shift
            ;;
        --pattern)
            TEST_PATTERN="$2"
            shift 2
            ;;
        *)
            TEST_PATTERN="$1"
            shift
            ;;
    esac
done

# Cleanup function
cleanup() {
    if [ "$KEEP_RUNNING" = false ]; then
        log_info "Cleaning up test environment..."
        cd "$ROOT_DIR"
        docker-compose -f docker-compose.test.yml down -v 2>/dev/null || true
    else
        log_info "Keeping test environment running (--keep-running specified)"
    fi
}

# Set trap for cleanup
trap cleanup EXIT

# Start test environment
log_info "Starting test environment..."
cd "$ROOT_DIR"
docker-compose -f docker-compose.test.yml up -d --build

# Wait for services to be healthy
log_info "Waiting for services to be healthy..."

wait_for_service() {
    local url=$1
    local name=$2
    local max_attempts=60
    local attempt=1

    while [ $attempt -le $max_attempts ]; do
        if curl -s "$url" > /dev/null 2>&1; then
            log_info "$name is ready!"
            return 0
        fi
        echo -n "."
        sleep 2
        attempt=$((attempt + 1))
    done

    log_error "$name failed to become ready after $max_attempts attempts"
    return 1
}

echo -n "Waiting for Backend API"
wait_for_service "http://localhost:3001/health" "Backend API"

echo -n "Waiting for Frontend"
wait_for_service "http://localhost:3002" "Frontend"

log_info "All services are ready!"

# Run tests
cd "$ROOT_DIR/packages/frontend"

PLAYWRIGHT_ARGS=""
if [ "$HEADED" = true ]; then
    PLAYWRIGHT_ARGS="--headed"
fi
if [ "$DEBUG" = true ]; then
    PLAYWRIGHT_ARGS="$PLAYWRIGHT_ARGS --debug"
fi
if [ -n "$TEST_PATTERN" ]; then
    PLAYWRIGHT_ARGS="$PLAYWRIGHT_ARGS $TEST_PATTERN"
fi

log_info "Running E2E tests..."
E2E=true npx playwright test $PLAYWRIGHT_ARGS

log_info "E2E tests completed!"
