ARG NODE_IMAGE=node:22.22-bookworm
FROM ${NODE_IMAGE}

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

WORKDIR /workspace

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
COPY apps/backend/prisma/schema.prisma apps/backend/prisma/schema.prisma
COPY packages/eslint-config/package.json packages/eslint-config/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json

RUN pnpm install --frozen-lockfile
