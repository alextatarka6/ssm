# SSM

SSM is a small stock-simulation project with:

- a Python FastAPI backend for trading, portfolios, and query endpoints
- a React + Vite frontend for login, portfolio viewing, market browsing, and charting
- a Python matching engine in `engine_py/`

## Project Layout

```text
engine_py/              Matching engine and core trading logic
server/backend/         FastAPI backend, routes, persistence, tests
server/frontend/        React frontend
server/src/             Existing Node server code
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

If `DATABASE_URL` is not set, it falls back to a local SQLite database.

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

## Running Tests

Backend tests:

```bash
pytest -q server/backend/tests/test_api.py
```

## Current Frontend Flow

- enter a user ID on the login page
- load that user's portfolio
- view owned stocks, market assets, and chart data

If the user does not exist, the frontend shows the backend error message.

