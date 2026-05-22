FROM node:24-alpine AS app

WORKDIR /app

RUN corepack enable
RUN apk add --no-cache ffmpeg

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile
RUN pnpm typecheck

ENV NODE_ENV=production

CMD ["node", "apps/api/dist/server.js"]
