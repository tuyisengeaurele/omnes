# OMNES

OMNES is a desktop business suite for small and mid-sized retailers, starting with a
production-grade point-of-sale and expanding into inventory, CRM, reporting, and
administration.

## Requirements

- Node.js 22 (see `.nvmrc`)
- pnpm 9+

## Getting started

```bash
pnpm install
pnpm dev
```

This starts the Electron app with hot reload on the renderer.

## Scripts

| Script           | Purpose                                          |
| ---------------- | ------------------------------------------------ |
| `pnpm dev`       | Run the app in development with hot reload       |
| `pnpm build`     | Build main, preload, and renderer for production |
| `pnpm typecheck` | Type-check main, preload, and renderer           |
| `pnpm lint`      | Lint the codebase                                |
| `pnpm format`    | Format the codebase with Prettier                |
| `pnpm test`      | Run unit tests                                   |
| `pnpm test:e2e`  | Build, then run Playwright end-to-end tests      |
| `pnpm package`   | Produce an unpacked build via electron-builder   |

## Project status

This repository currently contains the application foundation: the Electron/React/
TypeScript shell, tooling, and CI. It does not yet include a database, authentication,
or any business modules — see [Architecture](docs/architecture.md) and
[docs/superpowers/specs/](docs/superpowers/specs/) for what's built and what's planned
next.

## Documentation

- [Architecture](docs/architecture.md)
- [Design specs](docs/superpowers/specs/)
- [Implementation plans](docs/superpowers/plans/)
