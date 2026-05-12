# --- Stage 1: Build the standalone binary ---
FROM oven/bun:1.2-debian AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Install the zerobox binary for the container's platform
RUN arch=$(uname -m) && \
    case "$arch" in \
        x86_64)  pkg="@zerobox/cli-linux-x64" ;; \
        aarch64) pkg="@zerobox/cli-linux-arm64" ;; \
        *)       echo "Unsupported arch: $arch" && exit 1 ;; \
    esac && \
    bun add --optional "$pkg"

COPY . .

# The unauthenticated rate limits are too aggressive for a Docker container
# where all requests share one IP. Patch them up so page loads don't 429.
RUN sed -i 's/auth: { max: 10, windowMs: 60_000 }/auth: { max: 1000, windowMs: 60_000 }/' src/hooks.server.ts && \
    sed -i 's/general: { max: 60, windowMs: 60_000 }/general: { max: 6000, windowMs: 60_000 }/' src/hooks.server.ts

# Docker overlay fs doesn't support cross-device rename (EXDEV).
# Patch the two renameSync calls in build-standalone.ts to use cpSync+rmSync instead.
RUN sed -i 's/renameSync,/&\n    cpSync,/' scripts/build-standalone.ts && \
    sed -i 's/renameSync(PI_TUI_DIR, PI_TUI_BACKUP);/{ cpSync(PI_TUI_DIR, PI_TUI_BACKUP, { recursive: true }); rmSync(PI_TUI_DIR, { recursive: true, force: true }); }/' scripts/build-standalone.ts && \
    sed -i 's/renameSync(PI_TUI_BACKUP, PI_TUI_DIR);/{ cpSync(PI_TUI_BACKUP, PI_TUI_DIR, { recursive: true }); rmSync(PI_TUI_BACKUP, { recursive: true, force: true }); }/' scripts/build-standalone.ts

RUN bun run build:standalone

# --- Stage 2: Clean runtime with just the binary ---
FROM debian:bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/build/standalone/vessel /usr/local/bin/vessel

RUN mkdir -p /app/data
WORKDIR /app

ENV HOST=0.0.0.0
ENV PORT=3000
ENV VESSEL_DATA_DIR=/app/data

EXPOSE 3000

ENTRYPOINT ["vessel"]
