ARG NODE_IMAGE=node:22.22-bookworm

FROM ${NODE_IMAGE} AS dependencies
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /workspace

RUN corepack enable \
    && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json

RUN pnpm install --frozen-lockfile

FROM dependencies AS source
COPY apps apps
COPY packages packages
COPY scripts scripts

FROM source AS backend-build
RUN pnpm --filter backend prisma:generate \
    && pnpm --filter backend build

FROM source AS frontend-build
ARG NEXT_PUBLIC_APP_NAME="Service Ops CRM"
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_APP_NAME=${NEXT_PUBLIC_APP_NAME}
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN test -n "${NEXT_PUBLIC_API_URL}" \
    && pnpm --filter frontend build

FROM ${NODE_IMAGE} AS backend
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
ENV NODE_ENV=production
WORKDIR /workspace

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      libreoffice-writer \
      libreoffice-calc \
      libreoffice-impress \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@10.33.0 --activate

COPY --from=backend-build --chown=node:node /workspace/node_modules node_modules
COPY --from=backend-build --chown=node:node /workspace/apps/backend/node_modules apps/backend/node_modules
COPY --from=backend-build --chown=node:node /workspace/apps/backend/package.json apps/backend/package.json
COPY --from=backend-build --chown=node:node /workspace/apps/backend/dist apps/backend/dist
COPY --from=backend-build --chown=node:node /workspace/apps/backend/prisma apps/backend/prisma
COPY --from=backend-build --chown=node:node /workspace/scripts scripts

USER node
EXPOSE 4000
CMD ["node", "apps/backend/dist/main.js"]

FROM ${NODE_IMAGE} AS frontend
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /workspace

RUN corepack enable \
    && corepack prepare pnpm@10.33.0 --activate

COPY --from=frontend-build --chown=node:node /workspace/node_modules node_modules
COPY --from=frontend-build --chown=node:node /workspace/apps/frontend/node_modules apps/frontend/node_modules
COPY --from=frontend-build --chown=node:node /workspace/apps/frontend/package.json apps/frontend/package.json
COPY --from=frontend-build --chown=node:node /workspace/apps/frontend/.next apps/frontend/.next
COPY --from=frontend-build --chown=node:node /workspace/scripts scripts

USER node
EXPOSE 3000
CMD ["pnpm", "--filter", "frontend", "start"]
