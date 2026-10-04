FROM node:22-bookworm-slim
# Debian slim: GNU tar+gzip ship in the base image and cover the backup engine.
# bash/curl/jq are required by the Proton Pass CLI installer; curl also serves the healthcheck.

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        bash \
        curl \
        jq \
        ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Proton Pass CLI — installed system-wide so modules can shell out to `pass-cli`
ENV PROTON_PASS_CLI_INSTALL_DIR=/usr/local/bin

RUN curl -fsSL https://proton.me/download/pass-cli/install.sh | bash \
    && pass-cli --version

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public
COPY mcps ./mcps-dist
COPY docker-entrypoint.sh ./
RUN node --check server/index.js \
 && node --check server/lib/assistant.js \
 && node --check public/assets/js/views/list.js \
 && node --check public/assets/js/views/station.js \
 && chmod +x docker-entrypoint.sh

ENV NODE_ENV=production \
    PORT=8788 \
    DATA_DIR=/data \
    MCPS_DIR=/app/mcps

VOLUME ["/data", "/app/mcps"]
EXPOSE 8788

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -fsS http://127.0.0.1:${PORT}/healthz || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
