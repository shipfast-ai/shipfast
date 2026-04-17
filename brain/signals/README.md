# Project Signals

Scans manifest and config files once per `shipfast init` / `shipfast refresh` and stores structured project data in brain.db, so every agent sees your framework, runtime, dependencies, and scripts in its fresh context without having to re-read files on every task.

## What gets scanned

| File | Captures |
|---|---|
| `package.json` | deps, devDeps, peerDeps, scripts, engines, packageManager, workspaces |
| `Cargo.toml` | dependencies, dev-dependencies, package name/version/edition, workspace members |
| `go.mod` | module path, Go version, require blocks (direct + indirect) |
| `pyproject.toml` | PEP 621 deps, Poetry deps+scripts, python version |
| `requirements.txt` (+ dev variants) | pinned pip packages |
| `Gemfile` | gems, ruby version, dev/test groups |
| `composer.json` | require, require-dev, scripts, php version |
| `pubspec.yaml` | Dart/Flutter deps, dart SDK constraint |
| `*.csproj` | PackageReference, TargetFramework |
| `mix.exs` | Elixir hex deps, app name, version |
| `tsconfig.json` / `jsconfig.json` | target, strict, paths, moduleResolution |
| `.nvmrc` / `.node-version` | Node version |
| `.python-version` / `.ruby-version` | runtime versions |
| `.tool-versions` (asdf) | all tool versions |
| `rust-toolchain[.toml]` | Rust toolchain channel |
| lockfiles | detects package manager (pnpm / npm / yarn / bun / cargo / poetry / …) |
| `.env.example` / `.env.sample` / `.env.template` | env var **names** only (values never read) |
| `pnpm-workspace.yaml` / `turbo.json` / `nx.json` / `lerna.json` | monorepo layout |

## Derived signals (computed from the above)

Stored in the `context` table under `scope='project'`:

- `framework` — Next.js, Nuxt, SvelteKit, Remix, Astro, Django, FastAPI, Rails, Laravel, Express, Fastify, Hono, NestJS, Axum, Rocket, Actix, Gin, etc.
- `test_framework` — vitest, jest, mocha, playwright, cypress, pytest, rspec, phpunit
- `orm` — Prisma, Drizzle, TypeORM, Sequelize, Mongoose, Knex, SQLAlchemy, Diesel, sqlx, GORM
- `component_library` — MUI, Chakra, Mantine, Radix, Ant Design
- `state_library` — Redux, Zustand, Jotai, Pinia, MobX, TanStack Query, SWR
- `http_client` — axios, ky, got, node-fetch, undici
- `css_approach` — Tailwind, styled-components, Emotion, Sass
- `package_manager` — best guess from `packageManager` field > lockfile presence
- `runtime` — best guess from .nvmrc / .python-version / rust-toolchain / engines

## Safety

- **Values from `.env` are never read.** Only `.env.example`-style files are scanned, and only variable **names** are stored.
- Real lockfiles (`package-lock.json`, `Cargo.lock`, etc.) are never parsed — only their presence is noted to infer the package manager.
- A malformed manifest in one file does not break scanning of the rest.

## Adding a new scanner

1. Create `brain/signals/<name>.cjs` exporting `{filenames: [...], scan(contents, filePath, cwd)}`
2. Add the path to `SCANNER_FILES` in `brain/signals/index.cjs`
3. Write a smoke test in `tests/test-core.test.cjs`

The scanner should return `{ deps?, scripts?, signals? }`. See `package_json.cjs` for the reference implementation.
