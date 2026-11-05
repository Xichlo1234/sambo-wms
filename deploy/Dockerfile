# ===== SAMBO GOLD WMS – image 1 container (API + giao diện) =====
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY client/package*.json client/
RUN cd client && npm ci
COPY client client
RUN cd client && npm run build
COPY server/package*.json server/
RUN cd server && npm ci
COPY server server
RUN cd server && npx prisma generate && npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
# postgresql-client: pg_dump / pg_restore cho chức năng sao lưu & khôi phục
RUN apt-get update && apt-get install -y openssl postgresql-client tar && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/server /app/server
COPY --from=build /app/client/dist /app/client/dist
COPY deploy/docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENV NODE_ENV=production PORT=4000 SERVE_CLIENT=true CLIENT_DIST=/app/client/dist STORAGE_DIR=/data PG_BIN_DIR=/usr/bin
VOLUME ["/data"]
EXPOSE 4000
WORKDIR /app/server
ENTRYPOINT ["/entrypoint.sh"]
