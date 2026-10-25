# ---------------------------------------------------------------------------
# 34A Quiz Arena - mehrstufiger Build
# Stufe 1 baut shared, Server und Client. Stufe 2 enthaelt nur die Laufzeit.
# ---------------------------------------------------------------------------

# --- Stufe 1: Abhaengigkeiten installieren ---------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# Build-Werkzeuge fuer native Module (better-sqlite3).
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci

# --- Stufe 2: Quellcode bauen ----------------------------------------------
FROM deps AS build
WORKDIR /app
COPY tsconfig.json* ./
COPY shared ./shared
COPY server ./server
COPY client ./client
RUN npm run build --workspace shared \
    && npm run build --workspace server \
    && npm run build --workspace client

# --- Stufe 3: Produktionsabhaengigkeiten -----------------------------------
FROM deps AS prod-deps
WORKDIR /app
RUN npm prune --omit=dev

# --- Stufe 4: Laufzeit ------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/quiz-arena.db

# Nicht als root laufen.
RUN groupadd --system --gid 1001 quiz \
    && useradd --system --uid 1001 --gid quiz --home /app quiz \
    && mkdir -p /app/data \
    && chown -R quiz:quiz /app

COPY --from=prod-deps --chown=quiz:quiz /app/node_modules ./node_modules
COPY --from=build --chown=quiz:quiz /app/package.json ./package.json
COPY --from=build --chown=quiz:quiz /app/shared/package.json ./shared/package.json
COPY --from=build --chown=quiz:quiz /app/shared/dist ./shared/dist
COPY --from=build --chown=quiz:quiz /app/server/package.json ./server/package.json
COPY --from=build --chown=quiz:quiz /app/server/dist ./server/dist
COPY --from=build --chown=quiz:quiz /app/client/dist ./client/dist
COPY --from=build --chown=quiz:quiz /app/server/scripts ./server/scripts

USER quiz
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
