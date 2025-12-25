FROM node:24-slim AS builder

ARG COMMIT_SHA

WORKDIR /app

# Install all dependencies (including dev for tsc)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN echo "{\"commit\":\"${COMMIT_SHA:-unknown}\"}" > version.json
RUN npm run build

# Unzip dictionary and set execute permission on scripts
RUN gunzip -k skills/cue/n+7/nouns.txt.gz \
    && chmod +x skills/cue/scripts/*.py

FROM node:24-slim

WORKDIR /app

# Install Python for skill scripts
RUN apt-get update && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled code and static assets
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/version.json ./version.json
COPY public ./public
COPY --from=builder /app/skills ./.claude/skills

# Create non-root user (Claude Code blocks bypassPermissions when running as root)
RUN useradd -m -s /bin/bash appuser \
  && chown -R appuser:appuser /app
USER appuser

# Expose port
EXPOSE 3000

# Start server
CMD ["npm", "start"]
