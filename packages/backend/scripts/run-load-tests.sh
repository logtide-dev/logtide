#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
COMPOSE_FILE="../../docker-compose.test.yml"
BASE_URL="http://localhost:3001"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(dirname "$(dirname "$BACKEND_DIR")")"

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║           LogTide E2E Load Testing Suite                   ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Parse arguments
TEST_TYPE="${1:-smoke}"
SKIP_BUILD="${2:-}"

cd "$ROOT_DIR"

# Step 1: Start infrastructure
echo -e "${YELLOW}📦 Step 1: Starting test infrastructure...${NC}"

if [ "$SKIP_BUILD" != "--skip-build" ]; then
    docker compose -f docker-compose.test.yml build backend-test
fi

docker compose -f docker-compose.test.yml up -d postgres-test redis-test mailhog-test

# Wait for dependencies
echo -e "${YELLOW}⏳ Waiting for PostgreSQL and Redis...${NC}"
sleep 5

# Start backend
docker compose -f docker-compose.test.yml up -d backend-test

# Step 2: Wait for backend to be healthy
echo -e "${YELLOW}⏳ Step 2: Waiting for backend to be healthy...${NC}"
MAX_RETRIES=30
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -s "$BASE_URL/health" > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Backend is healthy!${NC}"
        break
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo "   Waiting for backend... (attempt $RETRY_COUNT/$MAX_RETRIES)"
    sleep 2
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo -e "${RED}❌ Backend failed to start${NC}"
    docker compose -f docker-compose.test.yml logs backend-test
    exit 1
fi

# Step 3: Seed test data and get API key
echo -e "${YELLOW}🌱 Step 3: Seeding test data...${NC}"

# Run seed script inside the backend container
API_KEY=$(docker compose -f docker-compose.test.yml exec -T backend-test node dist/scripts/seed-load-test.js 2>/dev/null | tail -1)

if [ -z "$API_KEY" ] || [[ ! "$API_KEY" =~ ^lp_load_ ]]; then
    echo -e "${RED}❌ Failed to get API key from seed script${NC}"
    echo "Output was: $API_KEY"
    exit 1
fi

echo -e "${GREEN}✅ API Key obtained: ${API_KEY:0:20}...${NC}"

# Step 4: Run k6 tests
echo -e "${YELLOW}🚀 Step 4: Running k6 load tests ($TEST_TYPE)...${NC}"
echo ""

cd "$BACKEND_DIR"

# Create results directory
mkdir -p load-tests/results

case "$TEST_TYPE" in
    smoke)
        echo -e "${BLUE}Running smoke test (30s, 1 VU)...${NC}"
        k6 run --env BASE_URL="$BASE_URL" --env API_KEY="$API_KEY" load-tests/smoke.js
        ;;
    ingestion)
        echo -e "${BLUE}Running ingestion load test (~13 min)...${NC}"
        k6 run --env BASE_URL="$BASE_URL" --env API_KEY="$API_KEY" load-tests/ingestion.js
        ;;
    query)
        echo -e "${BLUE}Running query load test (~12 min)...${NC}"
        k6 run --env BASE_URL="$BASE_URL" --env API_KEY="$API_KEY" load-tests/query.js
        ;;
    all)
        echo -e "${BLUE}Running ALL load tests...${NC}"
        echo ""
        echo -e "${YELLOW}[1/3] Smoke test...${NC}"
        k6 run --env BASE_URL="$BASE_URL" --env API_KEY="$API_KEY" load-tests/smoke.js
        echo ""
        echo -e "${YELLOW}[2/3] Ingestion test...${NC}"
        k6 run --env BASE_URL="$BASE_URL" --env API_KEY="$API_KEY" load-tests/ingestion.js
        echo ""
        echo -e "${YELLOW}[3/3] Query test...${NC}"
        k6 run --env BASE_URL="$BASE_URL" --env API_KEY="$API_KEY" load-tests/query.js
        ;;
    *)
        echo -e "${RED}Unknown test type: $TEST_TYPE${NC}"
        echo "Usage: $0 [smoke|ingestion|query|all] [--skip-build]"
        exit 1
        ;;
esac

# Step 5: Cleanup (optional)
echo ""
echo -e "${YELLOW}🧹 Cleanup options:${NC}"
echo "   To stop containers: docker compose -f docker-compose.test.yml down"
echo "   To stop and remove volumes: docker compose -f docker-compose.test.yml down -v"

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                  Load tests completed!                     ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
