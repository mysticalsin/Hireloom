# Career-Ops · JobSeeker — make targets
#
# Quick-reference:
#   make            # show this help
#   make install    # interactive installer (asks docker vs local)
#   make docker     # docker compose up -d
#   make local      # npm install + npm start
#   make start      # start the dashboard (local)
#   make stop       # stop everything (docker + local)
#   make logs       # tail dashboard logs (docker)
#   make test       # run unit tests
#   make doctor     # diagnose environment
#   make update     # pull + apply system updates
#   make backup     # snapshot user data to ./backups/
#   make clean      # remove transient state (does NOT touch user data)

SHELL := /bin/bash
.DEFAULT_GOAL := help
.PHONY: help install docker docker-prod local start stop restart logs shell \
        test doctor update backup clean wipe-cache rebuild

PORT ?= 4747
HOST ?= 127.0.0.1
URL  := http://$(HOST):$(PORT)

# Detect docker compose v2 vs legacy
DC := $(shell docker compose version >/dev/null 2>&1 && echo 'docker compose' || echo 'docker-compose')

help:
	@printf '\n  \033[36m\033[1mJobSeeker · Career-Ops\033[0m  ─  make targets\n\n'
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'
	@printf '\n  After install: open \033[36m$(URL)\033[0m → click ⊕ Profile to start onboarding.\n\n'

install: ## Interactive installer (docker | local)
	@bash install.sh

docker: ## Build + start containers in the background
	@bash install.sh --docker

docker-prod: ## Start with the hardened production overlay
	@$(DC) -f docker-compose.yaml -f docker-compose.hardened.yml up -d --build
	@printf '\n\033[32m✓\033[0m Production stack up at $(URL)\n\n'

local: ## Local install (npm install + tests + start)
	@bash install.sh --local

start: ## Start the dashboard (foreground, local)
	@PORT=$(PORT) HOST=$(HOST) node apps/web/server.mjs

start-bg: ## Start the dashboard in the background (local)
	@PORT=$(PORT) HOST=$(HOST) nohup node apps/web/server.mjs > .dashboard.log 2>&1 &
	@sleep 1; printf '\033[32m✓\033[0m Dashboard backgrounded — logs in .dashboard.log\n'

stop: ## Stop docker stack + any local server
	@$(DC) down 2>/dev/null || true
	@pkill -f "apps/web/server.mjs" 2>/dev/null || true
	@printf '\033[32m✓\033[0m Stopped\n'

restart: stop ## Stop, then start (docker)
	@$(DC) up -d
	@printf '\033[32m✓\033[0m Restarted at $(URL)\n'

logs: ## Tail dashboard logs (docker stack)
	@$(DC) logs -f --tail=100 career-ops

shell: ## Open a bash shell inside the running container
	@$(DC) exec career-ops /bin/bash

test: ## Run unit tests (Node test runner)
	@npm test

doctor: ## Diagnose environment + dashboard health
	@bash install.sh --doctor

update: ## Pull from origin + apply system updates (data untouched)
	@bash install.sh --update

backup: ## Snapshot user data to ./backups/<timestamp>/
	@mkdir -p backups
	@TS=$$(date +%Y%m%d-%H%M%S); \
	  DEST=backups/$$TS; \
	  mkdir -p $$DEST; \
	  for p in cv.md config data reports interview-prep article-digest.md portals.yml; do \
	    [ -e "$$p" ] && cp -r "$$p" "$$DEST/" || true; \
	  done; \
	  printf '\033[32m✓\033[0m Backed up to %s\n' "$$DEST"

clean: ## Remove caches + scratch (does NOT touch user data)
	@rm -rf tmp/ apps/web/.conductor/ engine/batch/tmp/ .dashboard.log
	@printf '\033[32m✓\033[0m Removed transient state\n'

rebuild: ## Force rebuild of the docker image (no cache)
	@$(DC) build --no-cache
	@printf '\033[32m✓\033[0m Image rebuilt\n'

wipe-cache: ## Drop Gmail + scan caches (forces re-scan on next run)
	@rm -f data/gmail-cache.json data/gmail-tokens.json data/scan-history.tsv 2>/dev/null
	@printf '\033[33m⚠\033[0m Caches wiped — next run will re-scan\n'
