begin;

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
    order by created_at asc, id asc
  loop
    perform public.ensure_initial_market_state_for_user(profile_record.id);
  end loop;
end;
$$;

commit;
