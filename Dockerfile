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

# Sandbox deps required by Claude Code CLI on Linux
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bubblewrap \
    socat \
    git \
    ripgrep \
  && rm -rf /var/lib/apt/lists/*

# Enable SDK debug logs (written to ~/.claude/debug)
ENV DEBUG_CLAUDE_AGENT_SDK=1

# Install Claude Code CLI (required by claude-agent-sdk)
RUN npm install -g @anthropic-ai/claude-code
RUN npm install -g @anthropic-ai/sdk

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
