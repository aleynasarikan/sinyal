# SİNYAL uygulama imajı. Tek runtime bağımlılığı maplibre-gl (Atlas; tarayıcıya aynı kökenden servis edilir).
FROM oven/bun:1.2.23-alpine AS base
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY data ./data
COPY migrations ./migrations
# Root olmayan kullanıcı
RUN mkdir -p /app/var && chown -R bun:bun /app/var
USER bun
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8790
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8790/api/health || exit 1
CMD ["bun", "run", "src/main.ts"]
