#!/bin/sh
set -e

echo "LogTide Backend Starting..."
echo "================================"

# Wait for PostgreSQL to be ready
echo "Waiting for PostgreSQL to be ready..."
MAX_RETRIES=30
RETRY_COUNT=0
# DATABASE_HOST/DATABASE_PORT predate DB_HOST/DB_PORT and still win when set
WAIT_HOST="${DATABASE_HOST:-${DB_HOST:-postgres}}"
WAIT_PORT="${DATABASE_PORT:-${DB_PORT:-5432}}"

while ! nc -z "$WAIT_HOST" "$WAIT_PORT" > /dev/null 2>&1; do
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
    echo "PostgreSQL is not available at $WAIT_HOST:$WAIT_PORT after $MAX_RETRIES attempts"
    exit 1
  fi
  echo "   Waiting for PostgreSQL at $WAIT_HOST:$WAIT_PORT... (attempt $RETRY_COUNT/$MAX_RETRIES)"
  sleep 2
done

echo "PostgreSQL is ready!"

# Run database migrations
echo ""
echo "Running database migrations..."
node dist/scripts/migrate.js

if [ $? -ne 0 ]; then
  echo "Migration failed"
  exit 1
fi

echo "Migrations completed successfully"
echo ""

# Start the application (server or worker)
if [ "$1" = "worker" ]; then
  echo "Starting LogTide Worker..."
  exec node dist/worker.js
else
  echo "Starting LogTide API Server..."
  exec node dist/server.js
fi
