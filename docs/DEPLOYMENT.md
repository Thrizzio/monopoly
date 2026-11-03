# Deployment

Not yet deployed. Do not deploy without explicit approval.

## Backend (Render, persistent Node web service)

- Root: repository root. Build: `npm ci && npm run build --workspace=@monopolisting/shared && npm run build --workspace=@monopolisting/server && npx prisma migrate deploy --schema apps/server/prisma/schema.prisma`.
- Start: `npm run start --workspace=@monopolisting/server`.
- Env: `NODE_ENV=production`, `PORT` (platform-provided), `DATABASE_URL`
  (Neon connection string), `SESSION_SECRET` (long random),
  `CLIENT_ORIGIN` (the Vercel URL).
- WebSockets must stay enabled. Do not use serverless functions for
  Socket.IO. One instance only (no Redis adapter yet).

See [render.yaml](../render.yaml).

## Frontend (Vercel)

- Project root directory: `apps/web`.
- Build: `npm run build`. Output: `dist`.
- Env: `VITE_API_URL` (the Render backend URL).

## Database (Neon)

- Reuse the existing `DATABASE_URL`. Migrations are additive and applied
  with `prisma migrate deploy` at release time. Never reset or reseed
  production data.
