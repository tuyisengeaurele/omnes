# Omnes

Multi-vertical delivery platform for Rwanda: food, grocery and parcel delivery on one driver
fleet and one customer identity. Ride-hailing is out of scope; see
[`docs/requirements-spec.md`](docs/requirements-spec.md) for why.

This repository is at the MVP build stage. See [`docs/build-plan.md`](docs/build-plan.md) for the
architecture decisions, the database schema outline and the phase-by-phase build order.

## Prerequisites

- Node.js 22.13 or later (the version this repo is pinned to is in [`.nvmrc`](.nvmrc))
- npm 10 or later
- PostgreSQL 17 (native install, see below) or Docker, either works
- git

Check your versions:

```bash
node --version
npm --version
```

## Database setup

Two supported paths. Native Postgres is the one actually verified against this machine; the
Docker path is written to be correct but has not been run here, since Docker is not installed on
this machine at time of writing.

### Path A: native PostgreSQL (verified)

Requires PostgreSQL 17 already installed and running as a service.

1. Connect as the postgres superuser and create the application role and database:

   ```bash
   psql -U postgres
   ```

   ```sql
   CREATE ROLE omnes_app WITH LOGIN CREATEDB PASSWORD 'your-local-password';
   CREATE DATABASE omnes_dev OWNER omnes_app;
   CREATE DATABASE omnes_test OWNER omnes_app;
   \q
   ```

   `CREATEDB` is required on this role, not just a convenience: Prisma Migrate creates and drops a
   temporary shadow database on every `prisma migrate dev` run, to detect drift between the schema
   file and the migration history. Without it, `migrate dev` fails with a permission error. CI uses
   `prisma migrate deploy` instead, which does not need a shadow database or this permission.

2. Copy the environment template and fill in `DATABASE_URL` with the password you just chose:

   ```bash
   cp .env.example .env
   ```

   ```
   DATABASE_URL=postgresql://omnes_app:your-local-password@localhost:5432/omnes_dev?schema=public
   ```

3. Confirm the connection works:

   ```bash
   psql "postgresql://omnes_app:your-local-password@localhost:5432/omnes_dev" -c "SELECT 1;"
   ```

### Path B: Docker Compose

```bash
docker compose up -d
cp .env.example .env
```

The default `.env.example` values already match `docker-compose.yml`'s `POSTGRES_USER` and
`POSTGRES_DB`. Set `POSTGRES_PASSWORD` in your shell before starting the container if you want
something other than the development-only default in the compose file.

## Install and run

```bash
npm install
```

`npm install` also wires up the project's git hooks (`core.hooksPath` points at `.githooks/`), so
the secret scan and the style scan run on every commit from that point on. Installing `apps/api`
also runs `prisma generate` automatically (its `postinstall` script), which is what produces
`apps/api/src/generated/prisma` - a build artifact, not checked into git.

### API workspace: schema, seed data, and running the server

```bash
npm run db:migrate --workspace apps/api   # applies every migration to omnes_dev
npm run db:seed --workspace apps/api      # Kigali city/zones, six merchants, staff users
npm run dev --workspace apps/api          # starts the API on the port set in .env
```

### Running the API's tests

The API's integration tests exercise the real Express app and the real database, against a
separate `omnes_test` database so a test run never touches `omnes_dev` data. `vitest.setup.ts`
loads `apps/api/.env.test` before the tests run; the Prisma CLI does not read that file on its
own, so the one-time migration step below sets `DATABASE_URL` explicitly instead.

```bash
cp apps/api/.env.test.example apps/api/.env.test
# fill in DATABASE_URL and the secret placeholders in apps/api/.env.test

cd apps/api
DATABASE_URL="postgresql://omnes_app:your-local-password@localhost:5432/omnes_test?schema=public" \
  npx prisma migrate deploy
cd ../..
```

Once `omnes_test` is migrated:

```bash
npm run test          # every workspace with a test script
npm run lint
npm run typecheck
npm run verify         # style scan, format check, lint, typecheck, test, in that order
```

## Repository layout

```
apps/
  api/             Express API. Modular internally: identity, catalog, order,
                   dispatch, payment, notification, ops.
  customer-web/    React customer app.
  merchant-web/    React merchant dashboard.
  admin-web/       React admin and ops dashboard.
packages/
  contracts/       Zod schemas shared between the API and every frontend.
  ui/              Shared shadcn/ui components and the Omnes theme.
  config/          Shared tsconfig, Tailwind preset and design tokens.
e2e/               Playwright end-to-end tests.
docs/              Requirements spec and build plan.
scripts/           Repo tooling: secret scan, style scan, commit message check.
```

## Working on this repository

**Branching.** `main` holds released work, `develop` is the integration branch, and feature work
happens on `feature/*` or `chore/*` branches cut from `develop` and merged back with
`git merge --no-ff`.

**Commits.** Conventional commit format: `type(scope): short description`, one logical change per
commit. Allowed types are `feat`, `fix`, `refactor`, `chore`, `test`, `docs`, `perf`, `build`,
`ci`, `style` and `revert`. A commit-msg hook enforces the format and rejects a subject over 72
characters.

**Prose style.** No em dashes, curly quotes or similar typographic marks anywhere in the
repository: code, comments, commit messages, or product copy. A pre-commit and commit-msg hook
enforce this; run `npm run scan:style` to check the whole tree manually.

**Secrets.** Nothing that looks like a credential may be committed, checked by
`scripts/check-secrets.mjs` in the same hooks. If a real secret ever does reach a commit, rotate
it immediately; rewriting history is not sufficient once a commit has been pushed to this public
remote.

**Bypassing a hook.** `git commit --no-verify` skips both checks locally. CI runs the same two
scans on every push (`--all` mode, over the whole tree, not only a diff), so a bypassed commit is
still caught before it can be merged.

## Security posture

Summarized here; the full checklist is in [`docs/build-plan.md`](docs/build-plan.md) section 6
and is walked before any module is considered done.

- Access tokens are short-lived JWTs in httpOnly cookies, never `localStorage`. Enforced by an
  ESLint rule as well as by convention.
- Refresh tokens rotate on every use and are stored hashed. Reuse of an already-rotated token
  revokes the entire token family.
- Every request body, query and param is validated server-side with Zod, regardless of what the
  client already validated.
- Role-based access control is enforced in the API on every merchant, admin and ops route. The
  frontend hiding a button is never the actual security boundary.
- `npm audit --audit-level=high` runs in CI on every push. Dependabot is configured
  (`.github/dependabot.yml`) for ongoing dependency updates, grouped so routine tooling bumps do
  not generate ten separate pull requests.

## Environment variables

See [`.env.example`](.env.example) for the full list with explanatory comments. The API validates
its configuration at startup and refuses to boot if a required variable is missing, so a
misconfigured deployment fails immediately rather than at the first request that needed the
missing value.

## A note on this machine's environment

Two things about the environment this repository was scaffolded on, worth knowing if you hit
something unexpected:

- **Docker is not installed here.** Path A above (native Postgres) is the one that has actually
  been run and verified on this machine. Path B is believed correct but unverified locally.
- **This directory sits inside OneDrive sync.** `node_modules` under active OneDrive sync can
  cause intermittent file-lock errors (`EPERM`, `EBUSY`) on Windows during `npm install` or while
  Vite is rebuilding. If you hit those, exclude this folder from OneDrive sync
  (OneDrive settings, Sync and backup, manage backup, or move the repo outside the synced tree).
