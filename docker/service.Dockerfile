# Shared Dockerfile for every Node service. Build context = repo root.
#   docker build -f docker/service.Dockerfile --build-arg SERVICE=auth-service .
FROM node:20-alpine AS build
ARG SERVICE
WORKDIR /app
COPY package.json tsconfig.base.json ./
COPY packages ./packages
COPY services/${SERVICE} ./services/${SERVICE}
RUN npm install --no-audit --no-fund
RUN npm run build -w @rental/common && npm run build -w services/${SERVICE}

FROM node:20-alpine
ARG SERVICE
ENV NODE_ENV=production SERVICE_DIR=/app/services/${SERVICE}
WORKDIR /app
COPY --from=build /app ./
RUN npm prune --omit=dev --no-audit --no-fund || true
USER node
CMD ["sh", "-c", "node $SERVICE_DIR/dist/index.js"]
