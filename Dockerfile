# syntax=docker/dockerfile:1

# ---- build: install all dependencies and compile server + client ----------
FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.server.json tsconfig.client.json ./
COPY src ./src
COPY public ./public
RUN npm run build

# ---- runtime: production dependencies, compiled assets, no .env -----------
FROM node:24-alpine AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public

# The app only reads files and keeps its state in memory.
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${PORT}/api/status" >/dev/null || exit 1

CMD ["node", "dist/server/index.js"]
