FROM node:24-slim AS builder

WORKDIR /app

# Install all dependencies (including dev for tsc)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

FROM node:24-slim

WORKDIR /app


# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled code and static assets
COPY --from=builder /app/dist ./dist
COPY public ./public

# Create non-root user (Claude Code blocks bypassPermissions when running as root)
RUN useradd -m -s /bin/bash appuser \
  && chown -R appuser:appuser /app
USER appuser

# Expose port
EXPOSE 3000

# Start server
CMD ["npm", "start"]
