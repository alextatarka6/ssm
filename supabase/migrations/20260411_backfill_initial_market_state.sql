begin;

create or replace function public.make_asset_id(profile_id uuid, username text)
returns text
language sql
immutable
as $$
  select concat(
    coalesce(nullif(regexp_replace(lower(trim(username)), '[^a-z0-9]+', '-', 'g'), ''), 'user'),
    '-',
    left(replace(profile_id::text, '-', ''), 8),
    '-stock'
  );
$$;

create or replace function public.ensure_initial_market_state_for_user(profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_row public.profiles%rowtype;
  next_asset_id text;
begin
  select *
  into profile_row
  from public.profiles
  where id = profile_id;

  if not found then
    return;
  end if;

  insert into public.user_accounts (auth_user_id, cash_cents, reserved_cash_cents)
  values (profile_row.id, 500000, 0)
  on conflict (auth_user_id) do update
  set cash_cents = greatest(public.user_accounts.cash_cents, 500000),
      reserved_cash_cents = public.user_accounts.reserved_cash_cents,
      updated_at = timezone('utc', now());

  select a.asset_id
  into next_asset_id
  from public.assets a
  where a.issuer_auth_user_id = profile_row.id
  order by
    case
      when a.asset_id = public.make_asset_id(profile_row.id, profile_row.username) then 0
      else 1
    end,
    a.created_at asc
  limit 1;

  if next_asset_id is null then
    next_asset_id := public.make_asset_id(profile_row.id, profile_row.username);

    insert into public.assets (asset_id, issuer_auth_user_id, total_supply, name)
    values (next_asset_id, profile_row.id, 1000, concat(profile_row.username, '''s asset'))
    on conflict (asset_id) do nothing;
  else
    update public.assets
    set total_supply = greatest(total_supply, 1000),
        name = coalesce(name, concat(profile_row.username, '''s asset')),
        updated_at = timezone('utc', now())
    where asset_id = next_asset_id;
  end if;

  insert into public.holdings (auth_user_id, asset_id, shares, reserved_shares)
  values
    (profile_row.id, next_asset_id, 400, 0)
  on conflict (auth_user_id, asset_id) do update
  set shares = greatest(public.holdings.shares, 400),
      reserved_shares = public.holdings.reserved_shares,
      updated_at = timezone('utc', now());
end;
$$;

create or replace function public.handle_auth_user_upsert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_username text;
begin
  next_username := nullif(trim(coalesce(new.raw_user_meta_data ->> 'username', '')), '');

  if next_username is null then
    next_username := split_part(coalesce(new.email, new.id::text), '@', 1);
  end if;

  insert into public.profiles (id, username, email)
  values (new.id, next_username, new.email)
  on conflict (id) do update
  set username = excluded.username,
      email = excluded.email,
      updated_at = timezone('utc', now());

  perform public.ensure_initial_market_state_for_user(new.id);

  return new;
end;
$$;

insert into public.profiles (id, username, email)
select
  u.id,
  coalesce(
    nullif(trim(u.raw_user_meta_data ->> 'username'), ''),
    split_part(coalesce(u.email, u.id::text), '@', 1)
  ),
  u.email
from auth.users u
on conflict (id) do update
set username = excluded.username,
    email = excluded.email,
    updated_at = timezone('utc', now());

do $$
declare
  profile_record record;
begin
  for profile_record in
    select id
    from public.profiles
  loop
    perform public.ensure_initial_market_state_for_user(profile_record.id);
  end loop;
end;
$$;

commit;
