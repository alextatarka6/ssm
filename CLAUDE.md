# Project Instructions for Claude Code

## Project Overview

**Section Stock Market (SSM)** is a stock market simulation game for a group. Each member gets their own stock. Players buy and sell each other's stocks with virtual money, competing for the highest net worth on a leaderboard. A treasury market-maker provides initial liquidity; price discovery only happens on user-to-user trades.

## Technology Stack

- **Frontend**: React 18 (JSX, no TypeScript), Vite 8
- **Backend**: Node.js 18+, Express 4, CommonJS modules
- **Package Manager**: npm
- **Database**: PostgreSQL (via `DATABASE_URL`) with JSON file fallback (`data/market-state.json`)
- **Auth**: Supabase (email/password)
- **Hosting**: AWS Amplify (frontend static build), AWS Elastic Beanstalk (backend)
- **Email**: nodemailer via SMTP for daily suggestion digest
- **Scheduling**: node-cron (daily email at 23:59 UTC)
- **No test suite** at this time

## Directory Structure

```
ssm/
├── data/
│   └── market-state.json        # Local dev snapshot fallback
└── server/
    ├── server.js                # Entry point — starts Express, cron jobs
    ├── package.json
    ├── frontend/                # React app (built and served statically)
    │   ├── vite.config.js
    │   ├── .env.mock            # Stub env vars for mock dev mode
    │   └── src/
    │       ├── main.jsx
    │       ├── App.jsx          # Single-file app (all UI + state)
    │       ├── api.js           # All fetch calls to backend
    │       ├── api.mock.js      # Mock API for dev:mock mode
    │       ├── config.js        # Reads + validates VITE_ env vars
    │       ├── index.css
    │       ├── components/
    │       │   └── StockChart.jsx
    │       └── utils/
    │           ├── supabase.js
    │           └── supabase.mock.js
    └── src/
        ├── app.js               # Express app setup, middleware, route mounting
        ├── config/index.js      # Reads all backend env vars
        ├── engine/
        │   ├── Market.js        # Core market engine (order book, matching, treasury)
        │   └── constants.js     # Side, OrderStatus, EventType, TREASURY_USER
        ├── models/              # Plain JS classes: User, Stock, Order, Holding, Trade
        ├── services/
        │   ├── marketService.js # Serialized mutation queue wrapping Market.js
        │   └── suggestionsService.js
        ├── storage/
        │   └── marketStore.js   # PostgreSQL or JSON file persistence
        ├── controllers/         # Route handlers (thin — delegate to marketService)
        ├── routes/              # Express routers
        ├── middleware/
        │   ├── requireApiKey.js
        │   ├── requireSupabaseAuth.js
        │   ├── requireAdmin.js  # Supabase JWT + ADMIN_USER_ID check
        │   ├── idempotency.js   # In-memory idempotency cache (5 min TTL)
        │   ├── rateLimiter.js   # express-rate-limit (600/min general, 30/min orders)
        │   ├── validators.js
        │   ├── errorHandler.js
        │   └── notFoundHandler.js
        └── utils/
            ├── asyncHandler.js
            ├── errors.js        # ApiError subclasses (NotFoundError, MarketPausedError, etc.)
            └── supabaseAdmin.js
```

## Key Architecture Notes

### Market Engine (`Market.js`)
- All market state lives in a single `Market` instance: users, stocks, orders, trades, cash
- Every mutation goes through `marketService.mutate()` which serializes writes via a promise queue and saves a snapshot after each change
- Price discovery: `lastPriceCents` only updates on user-to-user trades — treasury trades do NOT move price
- Treasury (`TREASURY_USER = "TREASURY"`) holds 90% of each stock's initial supply and places standing SELL orders at 1.05x last price to provide liquidity
- `Market.toSnapshot()` / `Market.fromSnapshot()` serialize/deserialize full state
- One-time data migrations run inside `fromSnapshot()`, guarded by `appliedMigrations` Set

### Route Structure

All routes under `/api` require `Authorization: Bearer <API_KEY>` unless noted.

```
GET    /health                              no auth — storage liveness check

DELETE /api/users/me                        requireSupabaseAuth (bypasses API key)

POST   /api/admin/market/pause             requireAdmin
POST   /api/admin/market/unpause           requireAdmin
POST   /api/admin/market/reset             requireAdmin
POST   /api/admin/users/:userId/reset      requireAdmin

GET    /api/users/
POST   /api/users/                         createUser (upsert)
GET    /api/users/:userId
PUT    /api/users/:userId
GET    /api/users/:userId/balance
GET    /api/users/:userId/portfolio
GET    /api/users/:userId/orders

GET    /api/assets/
POST   /api/assets/
GET    /api/assets/:assetId
PUT    /api/assets/:assetId
GET    /api/assets/:assetId/trades
GET    /api/assets/:assetId/candles
GET    /api/assets/:assetId/orderbook

POST   /api/orders/                        idempotency + orderLimiter (30/min)
POST   /api/orders/:orderId/cancel

GET    /api/market/leaderboard             includes paused flag
GET    /api/market/order-book/:assetId
POST   /api/market/buy                     legacy direct-fill endpoint
POST   /api/market/sell                    legacy direct-fill endpoint
POST   /api/market/process-orders          legacy

POST   /api/suggestions/
```

### Auth Layers
- **API key** (`Authorization: Bearer <API_KEY>`): required for all `/api` routes except `/api/users/me` DELETE and `/api/admin/*`
- **Supabase JWT**: required for `DELETE /api/users/me` and all admin routes
- **Admin**: Supabase JWT + backend checks `supabaseUser.id === ADMIN_USER_ID`
- Frontend admin UI gated by `VITE_ADMIN_USER_ID` (not a secret — just a user ID)

### Error Format
All API errors use `{ detail: "..." }` (not `{ error: ... }`).

### Frontend State
The entire app is a single component `App.jsx`. There is no routing library, no state management library, and no component library — all state is `useState`/`useEffect`, all styling is plain CSS in `index.css`.

## Development

### Backend
```bash
cd server
cp .env.example .env   # fill in values
npm install
npm run dev            # node --watch server.js
```

### Frontend (requires backend)
```bash
cd server/frontend
npm install
npm run dev            # requires VITE_ env vars set
```

### Frontend mock mode (no backend needed)
```bash
cd server/frontend
npm install
npm run dev:mock       # auto signs in, uses fake data
```

### Build frontend for production
```bash
cd server
npm run frontend:build
```

## Environment Variables

### Backend (Elastic Beanstalk)
| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Defaults to 8080 |
| `API_KEY` | Yes | Bearer token for API access |
| `DATABASE_URL` | No | PostgreSQL connection string; falls back to JSON file |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes | Supabase service role key (never expose to frontend) |
| `ADMIN_USER_ID` | Yes | Supabase UUID of the admin user |
| `CORS_ALLOWED_ORIGINS` | No | Comma-separated list of allowed origins; if unset, cross-origin requests are rejected |
| `SMTP_HOST` | No | SMTP server for suggestion emails |
| `SMTP_PORT` | No | Defaults to 587 |
| `SMTP_USER` | No | SMTP username |
| `SMTP_PASS` | No | SMTP password |
| `SUGGESTION_EMAIL_TO` | No | Recipient for daily suggestion digest |

### Frontend (Amplify)
| Variable | Required | Description |
|---|---|---|
| `VITE_BACKEND_URL` | Yes | Full URL of the backend (e.g. `https://api.example.com`) |
| `VITE_SUPABASE_URL` | Yes | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Yes | Supabase anon/public key |
| `VITE_ADMIN_USER_ID` | No | Supabase UUID of admin — gates admin UI visibility |

## Common Pitfalls

- **Never place buy orders from the treasury** — treasury buys would allow price manipulation to near-zero. Only treasury SELL orders are allowed.
- **All market mutations must go through `marketService.mutate()`** — direct calls to `market.*` methods bypass the serialization queue and snapshot saving.
- **`setMarketPaused` name collision** — `api.js` exports `setMarketPaused`; import it as `setMarketPausedApi` in `App.jsx` to avoid shadowing the React state setter.
- **Admin route ordering in `app.js`** — `/api/admin` is mounted before the general `/api` block so it uses Supabase auth instead of the API key middleware.
- **Treasury trades are non-price-moving** — `_executeTrade` takes an `updatePrice` flag; it is automatically set to `false` when either side is `TREASURY_USER`.
- **Snapshot migrations are one-time** — new migrations need a unique ID added to `appliedMigrations` and must be idempotent.
- **CORS is fail-closed** — if `CORS_ALLOWED_ORIGINS` is not set, all cross-origin requests are rejected. Add origins explicitly.

## Git Workflow

- Single `master` branch, deployed via Amplify (frontend) and Elastic Beanstalk (backend) on push
- Commit messages are descriptive present-tense summaries
- No PR process — direct commits to master

---

**Last updated**: Apr 28, 2026
**Maintained by**: inferno2606
