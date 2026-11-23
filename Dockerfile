# Family Hub: SvelteKit (adapter-node) + SQLite. Multi-arch: builds natively on
# arm64 (Mac/Colima) and amd64 (Unraid); no platform is pinned.
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Toolchain only as a fallback if a native prebuild (better-sqlite3) is unavailable.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/data/family-hub.db
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY drizzle ./drizzle
COPY tesserae ./tesserae
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "build"]
