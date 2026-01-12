# Build stage
FROM node:20-alpine AS builder

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/backend ./packages/backend

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build packages in order
RUN pnpm --filter '@logtide/shared' build
RUN pnpm --filter '@logtide/backend' build

# Production stage
FROM node:20-alpine

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/backend/package.json ./packages/backend/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built files
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=builder /app/packages/backend/migrations ./packages/backend/migrations

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
