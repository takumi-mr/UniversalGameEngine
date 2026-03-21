# apps/frontend/Dockerfile (multi-stage)
# Build Stage
FROM oven/bun:latest AS build

WORKDIR /app

# Copy root files for dependency resolution
COPY package.json bun.lock ./
COPY packages/shared packages/shared
COPY apps/frontend apps/frontend

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
