begin;

alter table public.profiles
  add column if not exists avatar_url text;

update public.profiles p
set avatar_url = nullif(trim(u.raw_user_meta_data ->> 'avatar_url'), '')
from auth.users u
where u.id = p.id
  and coalesce(p.avatar_url, '') = ''
  and nullif(trim(u.raw_user_meta_data ->> 'avatar_url'), '') is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-pictures',
  'profile-pictures',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "profile_pictures_public_read" on storage.objects;
create policy "profile_pictures_public_read"
on storage.objects
for select
to public
using (bucket_id = 'profile-pictures');

drop policy if exists "profile_pictures_insert_own" on storage.objects;
create policy "profile_pictures_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'profile-pictures'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "profile_pictures_update_own" on storage.objects;
create policy "profile_pictures_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'profile-pictures'
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'profile-pictures'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "profile_pictures_delete_own" on storage.objects;
create policy "profile_pictures_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'profile-pictures'
  and auth.uid()::text = (storage.foldername(name))[1]
);

commit;
