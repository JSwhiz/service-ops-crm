install:
	pnpm install

build:
	pnpm build

lint:
	pnpm lint

typecheck:
	pnpm typecheck

format:
	pnpm format

clean:
	pnpm clean

workspace-list:
	pnpm workspace:list

infra-up:
	docker compose --env-file .env.infra.local -f docker-compose.dev.yml up -d

infra-down:
	docker compose --env-file .env.infra.local -f docker-compose.dev.yml down

infra-logs:
	docker compose --env-file .env.infra.local -f docker-compose.dev.yml logs -f

infra-ps:
	docker compose --env-file .env.infra.local -f docker-compose.dev.yml ps

infra-restart:
	docker compose --env-file .env.infra.local -f docker-compose.dev.yml down
	docker compose --env-file .env.infra.local -f docker-compose.dev.yml up -d

bootstrap-local:
	pnpm bootstrap:local

db-generate:
	pnpm db:generate

db-migrate:
	pnpm db:migrate

db-seed:
	pnpm db:seed
