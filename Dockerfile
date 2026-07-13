# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json tsconfig*.json ./

# Install all dependencies including devDependencies
RUN npm ci

# Copy source code
COPY src ./src

# Compile TypeScript
RUN npm run build

# Stage 2: Production image
FROM node:22-alpine

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built files
COPY --from=builder --chown=node:node /app/dist ./dist

# Expose port
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/v1/health/ready').then((res) => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1))"

USER node

# Start the server
CMD ["node", "dist/server.js"]
