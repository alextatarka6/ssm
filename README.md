# SSM

SSM is a small stock-simulation project with:

- a Python FastAPI backend for trading, portfolios, and query endpoints
- a React + Vite frontend for Supabase auth, portfolio viewing, market browsing, and charting
- a Python matching engine in `server/backend/engine.py`

## Project Layout

```text
server/backend/         FastAPI backend, matching engine, routes, persistence, tests
server/frontend/        React frontend
```

## Requirements

- Python 3.10+
- Node.js 18+
- npm

## Backend Setup

From the repo root:

```bash
pip install -r server/backend/requirements.txt
```

The backend loads environment variables from:

```text
server/backend/.env
```

Set `DATABASE_URL` to the same Postgres database used by your Supabase project so auth-linked market state and backend queries stay in sync. If `DATABASE_URL` is not set, it falls back to a local SQLite database.

## Supabase

The frontend uses Supabase Auth for email/password sign-in and registration. Supabase SQL migrations for auth-linked profiles plus portfolio/trading tables live in:

```text
supabase/migrations/
```

Those migrations keep login records in `auth.users`, create app tables in `public`, and backfill initial balances and asset allocation. See [supabase/README.md](/home/inferno/projects/ssm/supabase/README.md) for the schema summary and migration notes.

For the frontend, define these Vite env vars:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

## Run The Backend

From the repo root:

```bash
cd server
npm run dev:py
```

That starts FastAPI on:

```text
http://localhost:8000
```

API routes are mounted under:

```text
/api
```

Examples:

- `GET /api/assets`
- `GET /api/users/{user_id}/portfolio`
- `GET /api/assets/{asset_id}/candles`

If the frontend has been built, the backend also serves the static app from `/`.

## Run The Frontend

For local frontend development:

```bash
cd server/frontend
npm install
npm run dev
```

That starts Vite on:

```text
http://localhost:5173
```

The frontend expects the backend API at:

```text
http://localhost:8000/api
```

You can change that with `VITE_API_BASE_URL` if needed.

## Build The Frontend

```bash
cd server/frontend
npm install
npm run build
```

The production build is written to:

```text
server/frontend/dist
```

Once built, those files can be served by the FastAPI app.

## Deploy To GitHub Pages

GitHub Pages can host the React frontend in `server/frontend`, but it cannot run the FastAPI backend. For a working production app, deploy the backend somewhere else first, then point the frontend at that API.

This repo includes a GitHub Actions workflow at [.github/workflows/deploy-pages.yml](/home/inferno/projects/ssm/.github/workflows/deploy-pages.yml) that builds the Vite app and publishes `server/frontend/dist` to GitHub Pages on pushes to `master` or `main`.

Before using it, add these repository-level settings in GitHub:

- repository variable `VITE_SUPABASE_URL`
- repository secret `VITE_SUPABASE_PUBLISHABLE_KEY`
- repository variable `VITE_API_BASE_URL`

`VITE_API_BASE_URL` should be the full deployed backend URL ending in `/api`, for example:

```text
https://your-backend.example.com/api
```

Then enable GitHub Pages in the repository settings:

1. Open `Settings` -> `Pages`.
2. Under `Build and deployment`, set `Source` to `GitHub Actions`.
3. Push to `main` or `master`, or run the workflow manually from the `Actions` tab.

The workflow automatically builds the frontend with the correct GitHub Pages base path, so project sites like `https://username.github.io/ssm/` work without hand-editing asset URLs.

## Running Tests

Backend tests:

```bash
pytest -q server/backend/tests/test_api.py
```

## Current Frontend Flow

- register or sign in with email/password through Supabase Auth
- create the trading user record automatically the first time an authenticated user opens the dashboard
- load portfolio holdings from the API and cash balances from `public.user_accounts`
- default the chart to the signed-in user's issued asset when one exists
- browse the market list and inspect Heikin Ashi candles for any asset with trade history

If an asset has no trade history yet, the chart panel shows an empty-state message instead of candles.
