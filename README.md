# Monopoly Online — Phase 1 Foundation

## Workspaces

- `apps/web`: React + Vite + Tailwind dev server on :5173
- `apps/server`: Express + Socket.IO API on :3000
- `packages/shared`: types, Zod schemas, constants

## Setup

```sh
npm install
cp .env.example .env
npm run db:generate --workspace=apps/server
npm run db:migrate --workspace=apps/server
npm run dev --workspace=apps/web
npm run dev --workspace=apps/server
```

PostgreSQL for local dev runs in Docker as `monopolisting-db` on port 5433.
