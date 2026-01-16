.PHONY: install build build-check dev run clean lint format pre-commit help

# Default target
.DEFAULT_GOAL := help

## install: Install dependencies
install:
	bun install

## build: Compile TypeScript to JavaScript
build:
	bun run build

## build-check: Type-check without emitting files
build-check:
	bun run build:check

## build-bin: Build standalone binary
build-bin:
	bun run build:bin

## dev: Run in development mode with auto-reload
dev:
	bun run dev $(ARGS)

## run: Run the CLI with arguments
run:
	bun run src/index.ts $(ARGS)

## lint: Run ESLint
lint:
	bun run lint

## lint-fix: Run ESLint with auto-fix
lint-fix:
	bun run lint:fix

## format: Format code with Prettier
format:
	bun run format

## pre-commit: Run pre-commit checks (lint, format, type-check)
pre-commit:
	bun run pre-commit

## electron-dev: Run Electron app in development mode
electron-dev:
	bun run electron:dev

## electron-build: Build Electron app for distribution
electron-build:
	bun run electron:build

## clean: Remove build artifacts
clean:
	rm -rf dist/ out/ release/

## help: Show this help message
help:
	@echo "Proton Drive WebDAV Bridge - WebDAV bridge for Proton Drive"
	@echo ""
	@echo "Usage: make <target>"
	@echo ""
	@echo "Targets:"
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## /  /'
