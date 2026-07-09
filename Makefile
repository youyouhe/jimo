SHELL = /bin/bash

# =============================================================
# Low-Code Platform Build + Deploy
# =============================================================
# Run from repo root: make <target>
# =============================================================

LOWCODE_DIR = jimo
INFRA_DIR  = infrastructure

# ---- Low-Code Platform ----

.PHONY: lowcode-install lowcode-build lowcode-dev-server lowcode-dev-web lowcode-dev

lowcode-install:
	@cd ${LOWCODE_DIR} && pnpm install

lowcode-build:
	@cd ${LOWCODE_DIR}/apps/server && pnpm run build
	@cd ${LOWCODE_DIR}/apps/web && pnpm run build

lowcode-dev-server:
	@cd ${LOWCODE_DIR}/apps/server && pnpm run dev

lowcode-dev-web:
	@cd ${LOWCODE_DIR}/apps/web && pnpm run serve

lowcode-dev:
	@echo "Lowcode dev: server → localhost:8888 | web → localhost:8000"

# ---- Docker Compose (run from repo root) ----

.PHONY: dev down

dev:
	docker compose -f ${INFRA_DIR}/docker-compose.dev.yml up -d

down:
	docker compose -f ${INFRA_DIR}/docker-compose.dev.yml down
