# Container Guide

Memoria ships with a baseline `Dockerfile` for quick container usage.

## Build and Run

```bash
docker build -t memoria:local .
docker run --rm memoria:local
```

Default container command runs:

- `./cli verify`
- `node dist/cli.mjs --help`

## Interactive Usage

```bash
docker run --rm -it -v "$(pwd)":/workspace -w /workspace memoria:local bash
```

Then initialize and verify in mounted workspace:

```bash
./install.sh --minimal
./cli init
./cli verify
```

## Notes

- Base image: `node:22-slim`
- `pnpm` is enabled via `corepack`
- Build stage generates `dist/cli.mjs`
