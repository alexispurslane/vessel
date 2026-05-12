# Cross-Platform Linux Testing with Docker

Multi-stage build: compiles a native standalone binary in a Bun container, then copies it into a clean `debian:bookworm-slim` image (no Bun, no source, no node_modules in the runtime).

## Build

```sh
docker build -t vessel:latest .
```

## Run

```sh
# Basic
docker run -d --name vessel -p 3000:3000 vessel:latest

# With persistent data (survives `docker rm`)
docker run -d --name vessel -p 3000:3000 -v vessel-data:/app/data vessel:latest

# Custom port
docker run -d --name vessel -p 8080:8080 -e PORT=8080 vessel:latest
```

Web UI at **http://localhost:3000**.

## Logs

```sh
docker logs -f vessel          # follow
docker logs --tail 50 vessel    # last N lines
docker logs -t vessel           # with timestamps
```

## Rebuild

```sh
docker rm -f vessel && docker build -t vessel:latest . && docker run -d --name vessel -p 3000:3000 vessel:latest
```
