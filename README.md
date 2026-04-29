# SSM — Section Stock Market

**Live site:** https://master.dcy1agiyvre79.amplifyapp.com

A stock-market simulation where every user gets their own tradeable stock. Built with a Node.js/Express backend (in-memory matching engine, snapshot persistence) and a React + Vite frontend backed by Supabase Auth.

## Project Layout

```
server/             Node.js backend (Express, matching engine, routes)
server/frontend/    React + Vite frontend
supabase/           Supabase migrations
```

## Backend

**Requirements:** Node.js 22+

**Environment variables** (create `server/.env`):

| Variable | Description |
|---|---|
| `PORT` | HTTP port (default `8080`) |
| `API_KEY` | Key required for internal API calls |
| `DATABASE_URL` | Postgres URL (for Supabase-linked user sync) |
| `DATA_FILE` | Path to JSON snapshot file for market persistence |
| `CORS_ALLOWED_ORIGINS` | Comma-separated allowed origins |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |

**Run (dev):**

```bash
cd server
npm install
npm run dev
```

Starts on `http://localhost:8080`. API routes are under `/api`.

## Frontend

**Environment variables** (create `server/frontend/.env`):

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase anon/publishable key |
| `VITE_API_BASE_URL` | Backend API base (default `/api`) |

**Run (dev):**

```bash
cd server
npm run frontend:dev
```

Starts Vite on `http://localhost:5173`, proxying API calls to the backend.

**Run with mock data (no backend or Supabase needed):**

```bash
cd server
npm run frontend:dev:mock
```

This swaps in `src/api.mock.js` and `src/utils/supabase.mock.js` via a Vite alias, so the app runs entirely with local stub data. No `.env` required.

**Build:**

```bash
cd server
npm run frontend:build
```

Output goes to `server/frontend/dist` and is served statically by the backend.

## Deployment

- **Frontend:** hosted on AWS Amplify. Build settings are in `amplify.yml`. Set the three `VITE_*` env vars in Amplify, with `VITE_API_BASE_URL` pointing to the deployed backend. See `DEPLOY_AMPLIFY.md` for the full checklist.
- **Backend:** runs on EC2 (`ssmEC2`, `us-east-2`). SSH access: `ssh -i alex-dev-laptop.pem ubuntu@ec2-18-221-139-100.us-east-2.compute.amazonaws.com` (key is gitignored).
