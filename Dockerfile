# ==============================================================================
# Multi-stage production Dockerfile for TaskFlow Multi-Tenant API
# Stage 1: Build & compile TypeScript
# Stage 2: Minimal unprivileged production runner (Node 22 Alpine)
# ==============================================================================

# --- Stage 1: Builder ---
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

# Copy source configuration and code
COPY tsconfig.json ./
COPY src ./src

# Generate Prisma client and compile TypeScript to dist/
RUN npx prisma generate
RUN npm run build

# --- Stage 2: Production Runner ---
FROM node:22-alpine AS runner

WORKDIR /app

# Create unprivileged application user
RUN addgroup -S taskflow && adduser -S taskflow -G taskflow

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Install production dependencies only
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --omit=dev && npx prisma generate

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Set file ownership to non-root user
RUN chown -R taskflow:taskflow /app

USER taskflow

EXPOSE 3000

# Container healthcheck against /health endpoint
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Start TaskFlow API server
CMD ["node", "dist/src/server.js"]
