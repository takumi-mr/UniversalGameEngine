# apps/frontend/Dockerfile (multi-stage)
# Build Stage
FROM oven/bun:latest AS build

WORKDIR /app

# Copy root files for dependency resolution
COPY package.json bun.lock tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/frontend apps/frontend
# ルート package.json が参照する他ワークスペースは package.json だけ置く（bun install の解決に必要）
COPY apps/backend/package.json apps/backend/package.json
COPY packages/input-prediction/package.json packages/input-prediction/package.json

# Install dependencies
RUN bun install --ignore-scripts

# WORKDIR to frontend and build
WORKDIR /app/apps/frontend

# Environment variables for build process (VITE_*)
# Update internal API endpoint if necessary
ENV VITE_API_BASE_URL=http://localhost:3000

RUN bun x vite build

# --- Production Stage ---
FROM nginx:alpine

# Copy built files from build stage
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html

# EXPOSE port 80 (standard Nginx port)
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
