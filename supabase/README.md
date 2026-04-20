# Supabase Schema

`auth.users` is the source of truth for login data in Supabase. The migration in `migrations/20260411_create_portfolio_schema.sql` adds:

- `public.profiles` for app-facing identity like `username` and mirrored `email`
- `public.user_accounts` for cash balances
- `public.assets`, `public.holdings`, `public.orders`, `public.trades`, and `public.events` for portfolio and market data

Apply it with the Supabase CLI:

```bash
supabase db push
```

That will apply both the base portfolio schema and the follow-up backfill migration that grants every user their starting cash and personal asset allocation.

If you prefer the dashboard SQL editor, run each migration file there in order.

For testing, `reset_market_state.sql` clears market activity in `public.trades`, `public.orders`, `public.events`, `public.holdings`, `public.assets`, and `public.user_accounts`, then reruns `public.ensure_initial_market_state_for_user(...)` for every row in `public.profiles`. It preserves `auth.users` and `public.profiles`, so the same users can sign back in after the reset.

If you want chart-ready fake activity, run `seed_fake_market_chart_data.sql` after your users exist. It rebuilds the public market tables from `public.profiles`, gives each user cash plus cross-holdings, and inserts deterministic order/trade history for every issued asset so the frontend candle chart has data immediately.
