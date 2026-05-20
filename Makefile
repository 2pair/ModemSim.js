@default: up

.PHONY: lint
lint:
	npm run lint

.PHONY: build
build:
	npm run build

.PHONY: dev
dev:
	npm run dev

.PHONY: start
start:
	npm start

.PHONY: install
install:
	npm ci

.PHONY: up
up: install build start

.PHONY: clean
clean:
	rm -rf dist/
