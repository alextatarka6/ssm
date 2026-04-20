begin;

-- Fail fast before any destructive work if the portfolio schema/backfill migrations
-- have not been applied in the current database yet.
do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'reset_market_state.sql requires public.profiles; apply the Supabase migrations first';
  end if;

  if to_regclass('public.user_accounts') is null then
    raise exception 'reset_market_state.sql requires public.user_accounts; apply the Supabase migrations first';
  end if;

  if to_regclass('public.assets') is null then
    raise exception 'reset_market_state.sql requires public.assets; apply the Supabase migrations first';
  end if;

  if to_regclass('public.holdings') is null then
    raise exception 'reset_market_state.sql requires public.holdings; apply the Supabase migrations first';
  end if;

  if to_regclass('public.orders') is null then
    raise exception 'reset_market_state.sql requires public.orders; apply the Supabase migrations first';
  end if;

  if to_regclass('public.trades') is null then
    raise exception 'reset_market_state.sql requires public.trades; apply the Supabase migrations first';
  end if;

  if to_regclass('public.events') is null then
    raise exception 'reset_market_state.sql requires public.events; apply the Supabase migrations first';
  end if;

  if to_regprocedure('public.ensure_initial_market_state_for_user(uuid)') is null then
    raise exception 'reset_market_state.sql requires public.ensure_initial_market_state_for_user(uuid); apply the Supabase backfill migration first';
  end if;
end;
$$;

-- Remove market activity first so asset rows can be recreated cleanly.
delete from public.trades;
delete from public.orders;
truncate table public.events restart identity;

-- Clear derived portfolio state while keeping auth.users and public.profiles intact.
delete from public.holdings;
delete from public.assets;
delete from public.user_accounts;

-- Rebuild the default cash balance and personal asset allocation for every profile.
do $$
declare
  profile_record record;
begin
  for profile_record in
    select id
    from public.profiles
    where deleted_at is null
    order by created_at asc, id asc
  loop
    perform public.ensure_initial_market_state_for_user(profile_record.id);
  end loop;
end;
$$;

commit;
