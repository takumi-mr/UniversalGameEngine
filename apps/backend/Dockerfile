# apps/backend/Dockerfile
FROM oven/bun:latest

WORKDIR /app

# Copy root files for dependency resolution
COPY package.json bun.lock ./
COPY packages/shared packages/shared
COPY apps/backend apps/backend

# Install dependencies
RUN bun install --ignore-scripts

# Expose ports
# 3000: Express/Socket.io
# 50051: gRPC
EXPOSE 3000 50051

# Environment variables (can be overridden by compose)
ENV PORT=3000
ENV GRPC_PORT=50051
ENV NODE_ENV=production

# Run the server
CMD ["bun", "run", "apps/backend/server.ts"]
