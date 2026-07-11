FROM node:22-alpine
# busybox tar+gzip in the base image cover the backup engine — no extra packages

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public
COPY mcps ./mcps-dist
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

ENV NODE_ENV=production \
    PORT=8788 \
    DATA_DIR=/data \
    MCPS_DIR=/app/mcps

VOLUME ["/data", "/app/mcps"]
EXPOSE 8788

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
