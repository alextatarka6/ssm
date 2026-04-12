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
