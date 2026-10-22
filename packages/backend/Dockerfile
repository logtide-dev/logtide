# Build stage
FROM node:24-alpine AS builder

# Install pnpm and build dependencies for native modules (like bcrypt)
RUN apk add --no-cache python3 make g++ && \
    npm install -g pnpm@10

WORKDIR /app

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* tsconfig.base.json ./

# Copy all package.json files first to satisfy pnpm workspace requirements
# and allow for better caching of the install step
COPY packages/shared/package.json ./packages/shared/
COPY packages/reservoir/package.json ./packages/reservoir/
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Now copy the rest of the source for the packages we need to build
COPY packages/shared ./packages/shared
COPY packages/reservoir ./packages/reservoir
COPY packages/backend ./packages/backend

# Build packages in order
RUN pnpm --filter '@logtide/shared' build
RUN pnpm --filter '@logtide/reservoir' build
RUN pnpm --filter '@logtide/backend' build

# Production stage
FROM node:24-alpine

# Install pnpm and runtime dependencies (nc for entrypoint)
RUN apk add --no-cache netcat-openbsd && \
    npm install -g pnpm@10

WORKDIR /app

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/reservoir/package.json ./packages/reservoir/
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/

# Install production dependencies
RUN pnpm install --frozen-lockfile --prod

# Copy built files
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/reservoir/dist ./packages/reservoir/dist
COPY --from=builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=builder /app/packages/backend/migrations ./packages/backend/migrations

# Copy source scripts (for tsx runtime execution)
COPY --from=builder /app/packages/backend/src/scripts ./packages/backend/src/scripts
COPY --from=builder /app/packages/backend/tsconfig.json ./packages/backend/tsconfig.json
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/packages/reservoir/package.json ./packages/reservoir/package.json

# Copy entrypoint script
COPY packages/backend/entrypoint.sh ./packages/backend/entrypoint.sh
RUN chmod +x ./packages/backend/entrypoint.sh

# Set working directory to backend
WORKDIR /app/packages/backend

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

# Start server with entrypoint (handles migrations)
ENTRYPOINT ["./entrypoint.sh"]
CMD ["server"]
