FROM node:22-slim

WORKDIR /app

# Keep image minimal while still allowing fallback package manager path.
RUN corepack enable && corepack prepare pnpm@10 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# Build distributable artifact so runtime does not depend on tsx.
RUN pnpm run build

ENV MEMORIA_HOME=/app

# Default command: verify install and show help.
CMD ["bash", "-lc", "./cli verify && node dist/cli.mjs --help"]
